import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { ChevronDown, ChevronUp, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { decodeTerminalBytes } from '@/renderer/terminal/terminal-codec';
import { installTerminalImeMiddleInsertionFix } from '@/renderer/terminal/terminal-ime';
import { installTerminalRenderer } from '@/renderer/terminal/terminal-renderer';
import {
  createTerminalWheelAccumulator,
  terminalWheelModifiers,
  terminalWheelPosition,
} from '@/renderer/terminal/terminal-scroll';
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
  column?: number;
  row?: number;
  modifiers?: number;
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
  const connectionRef = useRef<{ restart: () => void } | null>(null);
  const wheelFrameRef = useRef<number | null>(null);
  const [wheelAccumulator] = useState(createTerminalWheelAccumulator);
  const wheelPositionRef = useRef<Pick<TerminalScrollRequest, 'column' | 'row' | 'modifiers'>>({});
  const openExternalRef = useRef(onOpenExternal);
  openExternalRef.current = onOpenExternal;
  const scrollRequestRef = useRef(onScrollRequest);
  scrollRequestRef.current = onScrollRequest;
  const [state, setState] = useState<'attaching' | 'attached' | 'closed' | 'error'>('attaching');
  const [message, setMessage] = useState('Attaching through Herdr…');
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const stableTimerRef = useRef<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');

  const closeSearch = () => {
    searchAddonRef.current?.clearDecorations();
    setSearchQuery('');
    setSearchOpen(false);
    terminalRef.current?.focus();
  };

  const copySelection = useCallback(async () => {
    const selection = terminalRef.current?.getSelection();
    if (!selection) {
      return;
    }
    try {
      await window.herdr.terminal.writeClipboard(selection);
      setCopyFeedback('Selection copied');
    } catch {
      setCopyFeedback('Could not copy selection');
    }
  }, []);

  const queueWheelScroll = (
    deltaY: number,
    deltaMode: number,
    viewportRows: number,
    position: Pick<TerminalScrollRequest, 'column' | 'row' | 'modifiers'>,
  ) => {
    wheelAccumulator.add(deltaY, deltaMode, viewportRows);
    wheelPositionRef.current = position;
    if (wheelFrameRef.current !== null) {
      return;
    }
    wheelFrameRef.current = window.requestAnimationFrame(() => {
      wheelFrameRef.current = null;
      const lines = wheelAccumulator.takeLines();
      if (lines === 0) {
        return;
      }
      scrollRequestRef.current?.({
        paneId: pane.pane_id,
        direction: lines < 0 ? 'up' : 'down',
        unit: 'line',
        amount: Math.abs(lines),
        ...wheelPositionRef.current,
      });
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily:
        '"SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
      fontSize: 14,
      fontWeight: 300,
      fontWeightBold: 500,
      macOptionClickForcesSelection: true,
      screenReaderMode: false,
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
    let disposed = false;
    let attachmentRequested = false;
    let everAttached = false;
    let receivedFrame = false;

    // Clipboard IPC is asynchronous. Keep subsequent input behind its paste so
    // a quick Return cannot execute the old prompt before the clipboard arrives.
    // This queue belongs to this terminal instance and is abandoned on teardown.
    let inputQueue = Promise.resolve();
    let queuedInputs = 0;
    const sendInput = async (text: string) => {
      if (!disposed && attachmentRequested) {
        await window.herdr.terminal.input({ paneId: pane.pane_id, text });
      }
    };
    const enqueueInput = (operation: () => Promise<void>) => {
      queuedInputs += 1;
      inputQueue = inputQueue
        .then(async () => {
          if (!disposed) await operation();
        })
        .catch(() => {
          if (!disposed) setCopyFeedback('Could not send terminal input');
        })
        .finally(() => {
          queuedInputs -= 1;
        });
    };
    const pasteClipboard = () => {
      // Capture each clipboard read immediately, but apply its result in key order.
      const clipboard = window.herdr.terminal.readClipboard().then(
        (text) => ({ text }),
        () => ({ text: undefined }),
      );
      enqueueInput(async () => {
        const { text } = await clipboard;
        if (disposed) return;
        if (text === undefined) {
          setCopyFeedback('Could not paste clipboard');
          return;
        }
        if (text) {
          // Herdr owns the real PTY's bracketed-paste mode. The renderer receives
          // viewport frames, so xterm.paste() cannot safely infer that mode.
          const result = await window.herdr.command({
            type: 'send-pane-input',
            paneId: pane.pane_id,
            text,
          });
          if (result.state !== 'connected') {
            if (!disposed) setCopyFeedback('Could not paste clipboard');
            return;
          }
        }
        if (!disposed) setCopyFeedback(text ? 'Clipboard pasted' : 'Clipboard is empty');
      });
    };

    const clearConnectionTimers = () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (stableTimerRef.current !== null) {
        window.clearTimeout(stableTimerRef.current);
        stableTimerRef.current = null;
      }
    };
    const attachWhenSized = () => {
      if (disposed || attachmentRequested || terminal.cols < 1 || terminal.rows < 1) {
        return;
      }
      if (everAttached) {
        terminal.reset();
      }
      setState('attaching');
      setMessage(everAttached ? 'Reconnecting through Herdr…' : 'Attaching through Herdr…');
      everAttached = true;
      attachmentRequested = true;
      receivedFrame = false;
      void window.herdr.terminal
        .open({ paneId: pane.pane_id, cols: terminal.cols, rows: terminal.rows })
        .catch((error: unknown) => {
          if (!disposed && attachmentRequested) {
            attachmentRequested = false;
            setState('error');
            setMessage(error instanceof Error ? error.message : 'Terminal attachment failed.');
          }
        });
    };
    const restart = () => {
      if (disposed) {
        return;
      }
      attachmentRequested = false;
      receivedFrame = false;
      clearConnectionTimers();
      setState('attaching');
      setMessage('Reconnecting through Herdr…');
      void window.herdr.terminal.close(pane.pane_id).finally(attachWhenSized);
    };
    connectionRef.current = { restart };

    void window.herdr.terminal
      .accessibilitySupportEnabled()
      .then((enabled) => {
        if (!disposed) {
          terminal.options.screenReaderMode = enabled;
        }
      })
      .catch(() => undefined);
    terminal.open(container);
    const renderer = installTerminalRenderer(terminal, () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        fitAddon.fit();
      }
    });
    const imeMiddleInsertionFix = installTerminalImeMiddleInsertionFix(terminal);
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        (event.key === 'PageUp' || event.key === 'PageDown') &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
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
        (event.key === '=' ||
          event.key === '+' ||
          event.key === '-' ||
          event.key === '_' ||
          event.key === '0' ||
          event.code === 'Equal' ||
          event.code === 'Minus' ||
          event.code === 'Digit0' ||
          event.code === 'NumpadAdd' ||
          event.code === 'NumpadSubtract' ||
          event.code === 'Numpad0')
      ) {
        return false;
      }
      if (event.type === 'keydown' && !event.altKey) {
        const key = event.key.toLowerCase();
        const terminalClipboardShortcut = event.metaKey || (event.ctrlKey && event.shiftKey);
        if (terminalClipboardShortcut && key === 'c' && terminalRef.current?.hasSelection()) {
          event.preventDefault();
          void copySelection();
          return false;
        }
        if (terminalClipboardShortcut && key === 'v') {
          event.preventDefault();
          void pasteClipboard();
          return false;
        }
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
        if (!receivedFrame) {
          receivedFrame = true;
          setState('attached');
          setMessage('Live control through Herdr');
          stableTimerRef.current = window.setTimeout(() => {
            retryRef.current = 0;
            stableTimerRef.current = null;
          }, 5_000);
        }
        terminal.write(decodeTerminalBytes(event.bytes));
      } else if (event.type === 'terminal.closed') {
        attachmentRequested = false;
        if (stableTimerRef.current !== null) {
          window.clearTimeout(stableTimerRef.current);
          stableTimerRef.current = null;
        }
        if (retryRef.current < 2) {
          retryRef.current += 1;
          setState('attaching');
          setMessage('Reattaching through Herdr…');
          retryTimerRef.current = window.setTimeout(attachWhenSized, 400 * retryRef.current);
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
      if (queuedInputs > 0) {
        enqueueInput(() => sendInput(value));
      } else {
        void sendInput(value);
      }
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      if (attachmentRequested) {
        void window.herdr.terminal.resize({ paneId: pane.pane_id, cols, rows });
      } else {
        attachWhenSized();
      }
    });
    const stopSessionEvents = window.herdr.onSessionEvent((event) => {
      if (event.event === 'desktop.engine_changed') {
        restart();
      }
    });
    let fitFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (fitFrame !== null) {
        return;
      }
      fitFrame = window.requestAnimationFrame(() => {
        fitFrame = null;
        fitTerminal();
        attachWhenSized();
      });
    });
    observer.observe(container);
    fitTerminal();
    attachWhenSized();

    return () => {
      disposed = true;
      connectionRef.current = null;
      observer.disconnect();
      if (fitFrame !== null) {
        window.cancelAnimationFrame(fitFrame);
      }
      if (wheelFrameRef.current !== null) {
        window.cancelAnimationFrame(wheelFrameRef.current);
        wheelFrameRef.current = null;
      }
      wheelAccumulator.reset();
      wheelPositionRef.current = {};
      stopEvents();
      stopSessionEvents();
      clearConnectionTimers();
      imeMiddleInsertionFix.dispose();
      input.dispose();
      resize.dispose();
      renderer.dispose();
      terminal.dispose();
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
      if (searchAddonRef.current === searchAddon) {
        searchAddonRef.current = null;
      }
      void window.herdr.terminal.close(pane.pane_id);
    };
  }, [copySelection, pane.pane_id, wheelAccumulator]);

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#0f0f10]">
      <section
        aria-label={`Terminal output ${pane.pane_id}`}
        className="isolate h-full w-full p-3"
        onWheelCapture={(event) => {
          const onScroll = scrollRequestRef.current;
          if (!onScroll || event.deltaY === 0) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const terminal = terminalRef.current;
          const screen = containerRef.current?.querySelector('.xterm-screen');
          const position =
            terminal && screen
              ? terminalWheelPosition(
                  event.clientX,
                  event.clientY,
                  screen.getBoundingClientRect(),
                  terminal.cols,
                  terminal.rows,
                )
              : undefined;
          queueWheelScroll(event.deltaY, event.deltaMode, terminal?.rows ?? 24, {
            ...position,
            modifiers: terminalWheelModifiers(event),
          });
        }}
        ref={containerRef}
      />
      {searchOpen ? (
        <div className="absolute right-3 top-3 space-y-1 rounded-base border-2 border-border bg-secondary-background p-1 shadow-shadow">
          <div className="flex items-center gap-1">
            <Input
              aria-label="Search visible terminal text"
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
          <p className="px-1 text-xs opacity-70">Scroll older output into view to search it.</p>
        </div>
      ) : null}
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
                connectionRef.current?.restart();
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
