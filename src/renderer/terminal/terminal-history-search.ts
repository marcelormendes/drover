import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { HerdrQuery, HerdrQueryResult } from '@/shared/desktop-api';

type SearchRequest = Extract<HerdrQuery, { type: 'search-pane-output' }>;
export type TerminalHistorySearchResult = Extract<HerdrQueryResult, { type: 'pane-search' }>;
type Direction = SearchRequest['direction'];
interface SearchState {
  open: boolean;
  query: string;
  phase: 'idle' | 'searching' | 'ready' | 'error';
  result: TerminalHistorySearchResult | null;
  error?: string;
}
interface PendingSearch {
  paneId: string;
  terminalId: string;
  query: string;
  direction: Direction;
  generation: number;
}
const initialState = (): SearchState => ({ open: false, query: '', phase: 'idle', result: null });
const SEARCH_DELAY_MS = 200;

function searchError(reason: unknown): string {
  const code =
    typeof reason === 'object' && reason !== null && 'code' in reason ? reason.code : undefined;
  const message = reason instanceof Error ? reason.message : 'Could not search terminal history.';
  // Electron can preserve only the message of a rejected IPC call.
  if (
    code === 'unknown_method' ||
    code === 'method_not_found' ||
    /\b(?:unknown method|method not found)\b/i.test(message) ||
    /unknown variant\s+[`'"]pane\.search[`'"]/i.test(message)
  ) {
    return 'Update Herdr to search terminal history.';
  }
  return message;
}

/** Search and viewport navigation belong to Herdr, not the renderer's frame buffer. */
export function useTerminalHistorySearch(paneId: string, terminalId: string) {
  const [state, setState] = useState<SearchState>(initialState);
  const stateRef = useRef(state);
  const identityRef = useRef({ paneId, terminalId });
  identityRef.current = { paneId, terminalId };
  const mounted = useRef(true);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<PendingSearch | undefined>(undefined);
  const running = useRef(false);
  const publish = useCallback((next: SearchState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);
  const cancelPending = useCallback(() => {
    generation.current += 1;
    clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = undefined;
  }, []);

  useLayoutEffect(() => {
    identityRef.current = { paneId, terminalId };
    mounted.current = true;
    cancelPending();
    publish(initialState());
    return () => {
      mounted.current = false;
      cancelPending();
    };
  }, [paneId, terminalId, cancelPending, publish]);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      // A request scrolls the real viewport. Serialize requests as well as
      // discarding stale results, so an older response cannot scroll after a newer one.
      while (pending.current) {
        const request = pending.current;
        pending.current = undefined;
        const current = () =>
          mounted.current &&
          stateRef.current.open &&
          request.generation === generation.current &&
          request.paneId === identityRef.current.paneId &&
          request.terminalId === identityRef.current.terminalId;
        if (!current()) continue;
        const cursor = stateRef.current.result?.cursor;
        try {
          const result = await window.herdr.query({
            type: 'search-pane-output',
            paneId: request.paneId,
            terminalId: request.terminalId,
            query: request.query,
            caseSensitive: false,
            direction: request.direction,
            ...(request.direction !== 'first' && cursor ? { cursor } : {}),
          });
          if (!current()) continue;
          if (
            result.type !== 'pane-search' ||
            result.paneId !== request.paneId ||
            result.terminalId !== request.terminalId ||
            result.query !== request.query ||
            result.caseSensitive !== false
          ) {
            throw new Error('Herdr returned a search result for a different terminal or query.');
          }
          publish({
            ...stateRef.current,
            result,
            error: undefined,
            phase: pending.current ? 'searching' : 'ready',
          });
        } catch (reason) {
          if (current())
            publish({
              ...stateRef.current,
              result: null,
              phase: pending.current ? 'searching' : 'error',
              error: searchError(reason),
            });
        }
      }
    } finally {
      running.current = false;
    }
  }, [publish]);

  const navigate = useCallback(
    (direction: Direction) => {
      const current = stateRef.current;
      if (!current.open || !current.query) return;
      clearTimeout(timer.current);
      timer.current = undefined;
      // Retain at most one waiting action; repeated typing replaces old searches.
      pending.current = {
        ...identityRef.current,
        query: current.query,
        direction,
        generation: generation.current,
      };
      publish({ ...current, phase: 'searching', error: undefined });
      void drain();
    },
    [drain, publish],
  );

  const changeQuery = useCallback(
    (query: string) => {
      cancelPending();
      publish({
        ...stateRef.current,
        query,
        result: null,
        error: undefined,
        phase: query ? 'searching' : 'idle',
      });
      if (query) timer.current = setTimeout(() => navigate('first'), SEARCH_DELAY_MS);
    },
    [cancelPending, navigate, publish],
  );
  const open = useCallback(() => publish({ ...stateRef.current, open: true }), [publish]);
  const close = useCallback(() => {
    cancelPending();
    publish(initialState());
  }, [cancelPending, publish]);

  return { ...state, openSearch: open, closeSearch: close, changeQuery, navigate };
}
