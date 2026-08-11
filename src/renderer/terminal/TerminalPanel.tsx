import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { ArrowDownToLine, ChevronDown, ChevronUp, Copy, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { decodeTerminalBytes } from '@/renderer/terminal/terminal-codec';
import type { PaneInfo } from '@/shared/herdr';

interface TerminalPanelProps {
  pane: PaneInfo;
  onOpenExternal?: (url: string) => void;
  onScrollRequest?: (request: TerminalScrollRequest) => void;
}

export interface TerminalScrollRequest {
  paneId: string;
  direction: 'up' | 'down';
  unit: 'line' | 'page';
  amount: number;
}

function isHttpUrl(candidate: string): boolean {
  try {
    const protocol = new URL(candidate).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function TerminalPanel({ pane, onOpenExternal, onScrollRequest }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchAddonRef = useRef<SearchAddon>(null);
  const terminalRef = useRef<Terminal>(null);
  const openExternalRef = useRef(onOpenExternal);
  openExternalRef.current = onOpenExternal;
  const scrollRequestRef = useRef(onScrollRequest);
  scrollRequestRef.current = onScrollRequest;
  const [state, setState] = useState<'attaching' | 'attached' | 'closed' | 'error'>('attaching');
  const [message, setMessage] = useState('Attaching through Herdr…');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [engineGeneration, setEngineGeneration] = useState(0);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const stableTimerRef = useRef<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hasSelection, setHasSelection] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');

  const closeSearch = () => {
    searchAddonRef.current?.clearDecorations();
    setSearchQuery('');
    setSearchOpen(false);
  };

  const copySelection = async () => {
    const selection = terminalRef.current?.getSelection();
    if (!selection) {
      return;
    }
    try {
      await navigator.clipboard.writeText(selection);
      setCopyFeedback('Selection copied');
    } catch {
      setCopyFeedback('Could not copy selection');
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: engineGeneration is an intentional dependency — the engine-changed event bumps it so this effect re-runs and the view attaches through the new engine.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    setState('attaching');
    setMessage(connectionAttempt ? 'Reconnecting through Herdr…' : 'Attaching through Herdr…');
    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      screenReaderMode: true,
      scrollback: 10_000,
      theme: {
        background: '#0f0f10',
        foreground: '#e6e6e6',
        cursor: '#4d9eff',
        cursorAccent: '#0f0f10',
        selectionBackground: '#4d9eff66',
      },
    });
    terminalRef.current = terminal;
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if ((event.metaKey || event.ctrlKey) && isHttpUrl(uri)) {
        event.preventDefault();
        openExternalRef.current?.(uri);
      }
    });
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);
    searchAddonRef.current = searchAddon;
    terminal.open(container);
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        (event.key === 'PageUp' || event.key === 'PageDown') &&
        scrollRequestRef.current
      ) {
        scrollRequestRef.current({
          paneId: pane.pane_id,
          direction: event.key === 'PageUp' ? 'up' : 'down',
          unit: 'page',
          amount: 1,
        });
        return false;
      }
      if (
        event.type === 'keydown' &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 'f'
      ) {
        setSearchOpen(true);
        return false;
      }
      if (
        event.type === 'keydown' &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 'c' &&
        terminalRef.current?.hasSelection()
      ) {
        // Standard terminal copy shortcut; only intercepts when a selection
        // exists so Ctrl+C keeps sending the interrupt to the pane.
        event.preventDefault();
        void copySelection();
        return false;
      }
      return true;
    });

    const fitTerminal = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        fitAddon.fit();
      }
    };

    const stopEvents = window.herdr.terminal.onEvent((event) => {
      if (event.paneId !== pane.pane_id) {
        return;
      }
      if (event.type === 'terminal.frame') {
        setState('attached');
        setMessage('Live control through Herdr');
        if (stableTimerRef.current === null) {
          // A connection that stays attached earns its retry budget back.
          stableTimerRef.current = window.setTimeout(() => {
            retryRef.current = 0;
            stableTimerRef.current = null;
          }, 5_000);
        }
        terminal.write(decodeTerminalBytes(event.bytes));
      } else if (event.type === 'terminal.closed') {
        if (stableTimerRef.current !== null) {
          clearTimeout(stableTimerRef.current);
          stableTimerRef.current = null;
        }
        if (retryRef.current < 2) {
          // The engine detaches cleanly during quick reopens and takeover
          // windows; reattach a bounded number of times before surfacing it.
          retryRef.current += 1;
          setState('attaching');
          setMessage('Reattaching through Herdr…');
          retryTimerRef.current = window.setTimeout(
            () => setConnectionAttempt((attempt) => attempt + 1),
            400 * retryRef.current,
          );
        } else {
          setState('closed');
          setMessage(event.reason);
        }
      } else {
        setState('error');
        setMessage(event.message);
      }
    });
    const input = terminal.onData((value) => {
      void window.herdr.terminal.input({ paneId: pane.pane_id, text: value });
    });
    let attachmentRequested = false;
    const attachWhenSized = () => {
      if (attachmentRequested || terminal.cols < 1 || terminal.rows < 1) {
        return;
      }
      attachmentRequested = true;
      void window.herdr.terminal
        .open({ paneId: pane.pane_id, cols: terminal.cols, rows: terminal.rows })
        .catch((error: unknown) => {
          setState('error');
          setMessage(error instanceof Error ? error.message : 'Terminal attachment failed.');
        });
    };
    const resize = terminal.onResize(({ cols, rows }) => {
      if (attachmentRequested) {
        void window.herdr.terminal.resize({ paneId: pane.pane_id, cols, rows });
      } else {
        attachWhenSized();
      }
    });
    const selection = terminal.onSelectionChange(() => setHasSelection(terminal.hasSelection()));
    const stopSessionEvents = window.herdr.onSessionEvent((event) => {
      // The engine target changed (local ↔ remote): the main process closed
      // every terminal controller, so this view must attach again through the
      // new engine even when the pane id is unchanged.
      if (event.event === 'desktop.engine_changed') {
        setEngineGeneration((generation) => generation + 1);
      }
    });
    const observer = new ResizeObserver(() => {
      fitTerminal();
      attachWhenSized();
    });
    observer.observe(container);
    fitTerminal();
    attachWhenSized();

    return () => {
      observer.disconnect();
      stopEvents();
      stopSessionEvents();
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (stableTimerRef.current !== null) {
        clearTimeout(stableTimerRef.current);
        stableTimerRef.current = null;
      }
      input.dispose();
      resize.dispose();
      selection.dispose();
      terminal.dispose();
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
      if (searchAddonRef.current === searchAddon) {
        searchAddonRef.current = null;
      }
      void window.herdr.terminal.close(pane.pane_id);
    };
  }, [connectionAttempt, engineGeneration, pane.pane_id]);

  return (
    <div className="relative min-h-0 flex-1 bg-[#0f0f10]">
      <section
        aria-label={`Terminal output ${pane.pane_id}`}
        className="h-full w-full p-3"
        onWheelCapture={(event) => {
          const onScroll = scrollRequestRef.current;
          if (!onScroll || event.deltaY === 0) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onScroll({
            paneId: pane.pane_id,
            direction: event.deltaY < 0 ? 'up' : 'down',
            unit: 'line',
            amount: 1,
          });
        }}
        ref={containerRef}
      />
      <div className="absolute right-3 top-3 flex items-center gap-2 opacity-50 transition-opacity focus-within:opacity-100 hover:opacity-100">
        {onScrollRequest ? (
          <>
            <Button
              aria-label="Scroll terminal one page up"
              className="size-8"
              onClick={() =>
                scrollRequestRef.current?.({
                  paneId: pane.pane_id,
                  direction: 'up',
                  unit: 'page',
                  amount: 1,
                })
              }
              size="icon"
              variant="neutral"
            >
              <ChevronUp aria-hidden="true" />
            </Button>
            <Button
              aria-label="Scroll terminal one page down"
              className="size-8"
              onClick={() =>
                scrollRequestRef.current?.({
                  paneId: pane.pane_id,
                  direction: 'down',
                  unit: 'page',
                  amount: 1,
                })
              }
              size="icon"
              variant="neutral"
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </>
        ) : null}
        <Button
          aria-label="Scroll terminal to bottom"
          className="size-8"
          onClick={() => terminalRef.current?.scrollToBottom()}
          size="icon"
          variant="neutral"
        >
          <ArrowDownToLine aria-hidden="true" />
        </Button>
        <Button
          aria-label="Copy terminal selection"
          className="size-8"
          disabled={!hasSelection}
          onClick={() => void copySelection()}
          size="icon"
          variant="neutral"
        >
          <Copy aria-hidden="true" />
        </Button>
        {searchOpen ? (
          <div className="flex items-center gap-1 rounded-base border-2 border-border bg-secondary-background p-1 shadow-shadow">
            <Input
              aria-label="Search terminal text"
              autoFocus
              className="h-8 w-52 bg-background text-foreground"
              onChange={(event) => {
                const query = event.target.value;
                setSearchQuery(query);
                if (query) {
                  searchAddonRef.current?.findNext(query, { incremental: true });
                } else {
                  searchAddonRef.current?.clearDecorations();
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeSearch();
                  return;
                }
                if (event.key !== 'Enter' || !searchQuery) {
                  return;
                }
                event.preventDefault();
                if (event.shiftKey) {
                  searchAddonRef.current?.findPrevious(searchQuery);
                } else {
                  searchAddonRef.current?.findNext(searchQuery);
                }
              }}
              type="search"
              value={searchQuery}
            />
            <Button
              aria-label="Previous search result"
              className="size-8"
              onClick={() => searchQuery && searchAddonRef.current?.findPrevious(searchQuery)}
              size="icon"
              variant="neutral"
            >
              <ChevronUp aria-hidden="true" />
            </Button>
            <Button
              aria-label="Next search result"
              className="size-8"
              onClick={() => searchQuery && searchAddonRef.current?.findNext(searchQuery)}
              size="icon"
              variant="neutral"
            >
              <ChevronDown aria-hidden="true" />
            </Button>
            <Button
              aria-label="Close terminal search"
              className="size-8"
              onClick={closeSearch}
              size="icon"
              variant="neutral"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <Button
            aria-label="Search terminal"
            className="size-8"
            onClick={() => setSearchOpen(true)}
            size="icon"
            variant="neutral"
          >
            <Search aria-hidden="true" />
          </Button>
        )}
      </div>
      {copyFeedback ? (
        <div className="sr-only" role="status">
          {copyFeedback}
        </div>
      ) : null}
      {state !== 'attached' ? (
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-end gap-2">
          <Badge className="pointer-events-none min-w-0 truncate font-mono" variant="neutral">
            <span
              aria-hidden="true"
              className={
                state === 'error'
                  ? 'size-2 rounded-full bg-chart-2'
                  : 'size-2 animate-pulse rounded-full bg-chart-3'
              }
            />
            {message}
          </Badge>
          {state === 'closed' || state === 'error' ? (
            <Button
              aria-label={`Reconnect ${pane.pane_id}`}
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => {
                retryRef.current = 0;
                setConnectionAttempt((attempt) => attempt + 1);
              }}
              size="sm"
              variant="neutral"
            >
              <RefreshCw aria-hidden="true" /> Reconnect
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="sr-only" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
