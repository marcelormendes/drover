import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const terminalEvents = vi.hoisted(() => ({
  listener: undefined as ((event: unknown) => void) | undefined,
}));
const resizeObserver = vi.hoisted(() => ({
  listener: undefined as ResizeObserverCallback | undefined,
}));
const sessionEvents = vi.hoisted(() => ({
  listener: undefined as
    | ((event: { event: string; data: Record<string, unknown> }) => void)
    | undefined,
}));
const searchAddon = vi.hoisted(() => ({
  findNext: vi.fn(),
  findPrevious: vi.fn(),
  clearDecorations: vi.fn(),
}));
const terminalControl = vi.hoisted(() => ({
  cols: 80,
  customKeyHandler: undefined as ((event: KeyboardEvent) => boolean) | undefined,
  dataListener: undefined as ((value: string) => void) | undefined,
  loadedAddons: [] as unknown[],
  options: undefined as
    | {
        screenReaderMode?: boolean;
        theme?: Record<string, string>;
      }
    | undefined,
  paste: vi.fn(),
  open: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn(),
  selection: '',
  write: vi.fn(),
  reset: vi.fn(),
  rows: 24,
}));
const rendererControl = vi.hoisted(() => ({ install: vi.fn(), dispose: vi.fn() }));
vi.mock('@/renderer/terminal/terminal-renderer', () => ({
  installTerminalRenderer: (...args: unknown[]) => {
    rendererControl.install(...args);
    return { dispose: rendererControl.dispose };
  },
}));
const webLinks = vi.hoisted(() => ({
  activate: undefined as ((event: MouseEvent, uri: string) => void) | undefined,
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext = searchAddon.findNext;
    findPrevious = searchAddon.findPrevious;
    clearDecorations = searchAddon.clearDecorations;
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    constructor(handler: (event: MouseEvent, uri: string) => void) {
      webLinks.activate = handler;
    }
  },
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options: { screenReaderMode?: boolean; theme?: Record<string, string> }) {
      terminalControl.options = options;
    }
    get cols() {
      return terminalControl.cols;
    }
    get rows() {
      return terminalControl.rows;
    }
    get options() {
      return terminalControl.options ?? {};
    }
    loadAddon(addon: unknown) {
      terminalControl.loadedAddons.push(addon);
    }
    open = terminalControl.open;
    focus = terminalControl.focus;
    write = terminalControl.write;
    paste = terminalControl.paste;
    reset = terminalControl.reset;
    dispose = terminalControl.dispose;
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      terminalControl.customKeyHandler = handler;
    }
    hasSelection() {
      return Boolean(terminalControl.selection);
    }
    getSelection() {
      return terminalControl.selection;
    }
    onData(listener: (value: string) => void) {
      terminalControl.dataListener = listener;
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
  },
}));

import { TerminalPanel } from '@/renderer/terminal/TerminalPanel';
import type { PaneInfo } from '@/shared/herdr';

vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(listener: ResizeObserverCallback) {
      resizeObserver.listener = listener;
    }
    observe() {}
    disconnect() {}
  },
);

const pane: PaneInfo = {
  pane_id: 'w1:p2',
  terminal_id: 'terminal-2',
  workspace_id: 'w1',
  tab_id: 'w1:t1',
  focused: true,
  agent_status: 'idle',
  state_labels: {},
  tokens: {},
  revision: 1,
};

function openTerminalSearch(modifiers: KeyboardEventInit = { metaKey: true }) {
  let intercepted: boolean | undefined;
  act(() => {
    intercepted = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: 'f', ...modifiers }),
    );
  });
  expect(intercepted).toBe(false);
}

describe('TerminalPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalControl.customKeyHandler = undefined;
    terminalControl.cols = 80;
    terminalControl.dataListener = undefined;
    terminalControl.loadedAddons = [];
    terminalControl.options = undefined;
    terminalControl.selection = '';
    terminalControl.paste.mockReset();
    terminalControl.reset.mockReset();
    terminalControl.rows = 24;
    terminalControl.write.mockReset();
    resizeObserver.listener = undefined;
    webLinks.activate = undefined;
    window.herdr = {
      terminal: {
        open: vi.fn(async () => undefined),
        input: vi.fn(async () => undefined),
        resize: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        readClipboard: vi.fn(async () => ''),
        writeClipboard: vi.fn(async () => undefined),
        accessibilitySupportEnabled: vi.fn(async () => false),
        onEvent: vi.fn((listener) => {
          terminalEvents.listener = listener;
          return () => undefined;
        }),
      },
      onSessionEvent: vi.fn((listener) => {
        sessionEvents.listener = listener;
        return () => undefined;
      }),
    } as unknown as typeof window.herdr;
  });

  it('matches the desktop dark theme in the terminal palette', () => {
    render(<TerminalPanel pane={pane} />);
    expect(terminalControl.options).toMatchObject({
      screenReaderMode: false,
      fontFamily:
        '"SF Mono", Menlo, Monaco, "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
      fontSize: 14,
      fontWeight: 300,
      fontWeightBold: 500,
      macOptionClickForcesSelection: true,
    });
    expect(terminalControl.options).not.toHaveProperty('lineHeight');

    expect(terminalControl.options?.theme).toEqual({
      background: '#0f0f10',
      foreground: '#e6e6e6',
      cursor: '#4d9eff',
      cursorAccent: '#0f0f10',
      selectionBackground: '#4d9eff66',
    });
  });

  it('installs the renderer after open and releases it before disposing the terminal', () => {
    const view = render(<TerminalPanel pane={pane} />);
    expect(rendererControl.install).toHaveBeenCalledOnce();
    expect(terminalControl.open.mock.invocationCallOrder[0]).toBeLessThan(
      rendererControl.install.mock.invocationCallOrder[0],
    );
    view.unmount();
    expect(rendererControl.dispose).toHaveBeenCalledOnce();
    expect(rendererControl.dispose.mock.invocationCallOrder[0]).toBeLessThan(
      terminalControl.dispose.mock.invocationCallOrder[0],
    );
  });

  it('contains xterm intrinsic dimensions within the pane', () => {
    render(<TerminalPanel pane={pane} />);

    expect(screen.getByRole('region', { name: 'Terminal output w1:p2' }).parentElement).toHaveClass(
      'min-h-0',
      'min-w-0',
      'overflow-hidden',
    );
  });

  it('enables xterm screen-reader DOM only when Electron accessibility is active', async () => {
    vi.mocked(window.herdr.terminal.accessibilitySupportEnabled).mockResolvedValue(true);

    render(<TerminalPanel pane={pane} />);

    await waitFor(() => expect(terminalControl.options?.screenReaderMode).toBe(true));
  });

  it('forwards terminal input without interpreting shell commands', () => {
    render(<TerminalPanel pane={pane} />);

    act(() => terminalControl.dataListener?.('claude --model opus\r'));

    expect(window.herdr.terminal.input).toHaveBeenCalledWith({
      paneId: pane.pane_id,
      text: 'claude --model opus\r',
    });
  });

  it('waits for usable terminal dimensions before attaching a newly mounted pane', async () => {
    terminalControl.cols = 0;
    terminalControl.rows = 0;
    render(<TerminalPanel pane={{ ...pane, pane_id: 'w2:pB' }} />);

    expect(window.herdr.terminal.open).not.toHaveBeenCalled();

    terminalControl.cols = 120;
    terminalControl.rows = 36;
    act(() => resizeObserver.listener?.([], {} as ResizeObserver));

    await waitFor(() =>
      expect(window.herdr.terminal.open).toHaveBeenCalledWith({
        paneId: 'w2:pB',
        cols: 120,
        rows: 36,
      }),
    );
  });

  it('reattaches automatically after clean closes and offers Reconnect when they persist', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);
    const emitClosed = () =>
      act(() => {
        terminalEvents.listener?.({
          type: 'terminal.closed',
          paneId: pane.pane_id,
          reason: 'Terminal control ended. Another client may have taken over this pane.',
        });
      });

    emitClosed();
    expect(screen.queryByRole('button', { name: 'Reconnect w1:p2' })).not.toBeInTheDocument();
    await waitFor(() => expect(window.herdr.terminal.open).toHaveBeenCalledTimes(2), {
      timeout: 3_000,
    });
    emitClosed();
    await waitFor(() => expect(window.herdr.terminal.open).toHaveBeenCalledTimes(3), {
      timeout: 3_000,
    });

    emitClosed();
    await user.click(await screen.findByRole('button', { name: 'Reconnect w1:p2' }));
    await waitFor(() => expect(window.herdr.terminal.open).toHaveBeenCalledTimes(4));
  });

  it.each([{ metaKey: true }, { ctrlKey: true }])(
    'opens accessible terminal search with %j + F',
    (modifiers) => {
      render(<TerminalPanel pane={pane} />);

      openTerminalSearch(modifiers);

      expect(screen.getByRole('searchbox', { name: 'Search terminal text' })).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Previous search result' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next search result' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close terminal search' })).toBeInTheDocument();
    },
  );

  it('searches terminal output incrementally as the query changes', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);

    openTerminalSearch();
    await user.type(screen.getByRole('searchbox', { name: 'Search terminal text' }), 'error');

    expect(searchAddon.findNext).toHaveBeenLastCalledWith(
      'error',
      expect.objectContaining({ incremental: true }),
    );
  });

  it('navigates terminal search results with explicit controls', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);

    openTerminalSearch();
    await user.type(screen.getByRole('searchbox', { name: 'Search terminal text' }), 'warning');
    searchAddon.findNext.mockClear();

    await user.click(screen.getByRole('button', { name: 'Next search result' }));
    await user.click(screen.getByRole('button', { name: 'Previous search result' }));

    expect(searchAddon.findNext).toHaveBeenCalledWith('warning');
    expect(searchAddon.findPrevious).toHaveBeenCalledWith('warning');
  });

  it('uses Enter and Shift+Enter to traverse terminal search results', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);

    openTerminalSearch();
    const search = screen.getByRole('searchbox', { name: 'Search terminal text' });
    await user.type(search, 'failure');
    searchAddon.findNext.mockClear();
    await user.type(search, '{Enter}');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(searchAddon.findNext).toHaveBeenCalledWith('failure');
    expect(searchAddon.findPrevious).toHaveBeenCalledWith('failure');
  });

  it('clears search decorations and query when terminal search closes', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);

    openTerminalSearch();
    await user.type(screen.getByRole('searchbox', { name: 'Search terminal text' }), 'done');
    await user.click(screen.getByRole('button', { name: 'Close terminal search' }));

    expect(searchAddon.clearDecorations).toHaveBeenCalledOnce();
    expect(terminalControl.focus).toHaveBeenCalledOnce();
    openTerminalSearch();
    expect(screen.getByRole('searchbox', { name: 'Search terminal text' })).toHaveValue('');
  });

  it('closes terminal search with Escape', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);

    openTerminalSearch();
    await user.type(screen.getByRole('searchbox', { name: 'Search terminal text' }), 'closed');
    await user.keyboard('{Escape}');

    expect(
      screen.queryByRole('searchbox', { name: 'Search terminal text' }),
    ).not.toBeInTheDocument();
    expect(searchAddon.clearDecorations).toHaveBeenCalledOnce();
    expect(terminalControl.focus).toHaveBeenCalledOnce();
  });

  it('copies terminal selection through Electron clipboard IPC with Cmd+C', async () => {
    render(<TerminalPanel pane={pane} />);
    terminalControl.selection = 'selected output';

    act(() => {
      terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
    });

    expect(window.herdr.terminal.writeClipboard).toHaveBeenCalledWith('selected output');
    expect(await screen.findByRole('status')).toHaveTextContent('Selection copied');
  });

  it('announces when copying the terminal selection fails', async () => {
    vi.mocked(window.herdr.terminal.writeClipboard).mockRejectedValueOnce(
      new Error('permission denied'),
    );
    render(<TerminalPanel pane={pane} />);
    terminalControl.selection = 'selected output';

    act(() => {
      terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Could not copy selection');
  });

  it('copies with the standard terminal shortcut when a selection exists', async () => {
    render(<TerminalPanel pane={pane} />);
    terminalControl.selection = 'selected output';

    const intercepted = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, shiftKey: true }),
    );

    expect(intercepted).toBe(false);
    expect(window.herdr.terminal.writeClipboard).toHaveBeenCalledWith('selected output');
    expect(await screen.findByRole('status')).toHaveTextContent('Selection copied');
  });

  it('always lets plain Ctrl+C pass through to the pane', () => {
    render(<TerminalPanel pane={pane} />);
    terminalControl.selection = 'selected output';

    const intercepted = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }),
    );

    expect(intercepted).toBe(true);
    expect(window.herdr.terminal.writeClipboard).not.toHaveBeenCalled();
  });

  it('pastes with Cmd+V through xterm so bracketed-paste handling reaches the pane', async () => {
    vi.mocked(window.herdr.terminal.readClipboard).mockResolvedValueOnce('pasted command');
    render(<TerminalPanel pane={pane} />);

    act(() => {
      terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key: 'v', metaKey: true }));
    });

    await waitFor(() => expect(terminalControl.paste).toHaveBeenCalledWith('pasted command'));
    expect(screen.getByRole('status')).toHaveTextContent('Clipboard pasted');
  });

  it('pastes with Ctrl+Shift+V', async () => {
    vi.mocked(window.herdr.terminal.readClipboard).mockResolvedValueOnce('shortcut paste');
    render(<TerminalPanel pane={pane} />);

    const intercepted = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true }),
    );

    expect(intercepted).toBe(false);
    await waitFor(() => expect(terminalControl.paste).toHaveBeenCalledWith('shortcut paste'));
  });
  it('allows window zoom in, zoom out, and reset zoom shortcuts through the custom key handler', () => {
    render(<TerminalPanel pane={pane} />);

    const zoomInEqual = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: '=', metaKey: true }),
    );
    const zoomInPlus = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: '+', ctrlKey: true }),
    );
    const zoomOutMinus = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: '-', metaKey: true }),
    );
    const resetZoomZero = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: '0', ctrlKey: true }),
    );
    const numpadAdd = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { code: 'NumpadAdd', metaKey: true }),
    );

    expect(zoomInEqual).toBe(false);
    expect(zoomInPlus).toBe(false);
    expect(zoomOutMinus).toBe(false);
    expect(resetZoomZero).toBe(false);
    expect(numpadAdd).toBe(false);
  });

  it('opens only modifier-clicked HTTP links through the injected callback', () => {
    const onOpenExternal = vi.fn();
    render(<TerminalPanel onOpenExternal={onOpenExternal} pane={pane} />);
    expect(webLinks.activate).toEqual(expect.any(Function));

    webLinks.activate?.(new MouseEvent('click'), 'https://example.com/plain');
    webLinks.activate?.(
      new MouseEvent('click', { metaKey: true }),
      'javascript:alert(document.domain)',
    );
    webLinks.activate?.(new MouseEvent('click', { ctrlKey: true }), 'http://localhost:3000/log');
    webLinks.activate?.(new MouseEvent('click', { metaKey: true }), 'https://example.com/docs');

    expect(onOpenExternal).toHaveBeenNthCalledWith(1, 'http://localhost:3000/log');
    expect(onOpenExternal).toHaveBeenNthCalledWith(2, 'https://example.com/docs');
    expect(onOpenExternal).toHaveBeenCalledTimes(2);
  });

  it('keeps the terminal clear of permanent overlay controls', () => {
    render(<TerminalPanel onScrollRequest={vi.fn()} pane={pane} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    openTerminalSearch();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal search' }));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('coalesces high-frequency wheel events into one engine scroll per frame', async () => {
    const onScrollRequest = vi.fn();
    render(<TerminalPanel onScrollRequest={onScrollRequest} pane={pane} />);
    const terminal = screen.getByRole('region', { name: 'Terminal output w1:p2' });

    for (let index = 0; index < 20; index += 1) {
      fireEvent.wheel(terminal, { deltaY: -120 });
    }

    await waitFor(() =>
      expect(onScrollRequest).toHaveBeenCalledWith({
        paneId: 'w1:p2',
        direction: 'up',
        unit: 'line',
        amount: 60,
      }),
    );
    expect(onScrollRequest).toHaveBeenCalledOnce();
  });

  it('emits engine-backed page scrolling from the focused terminal keyboard', () => {
    const onScrollRequest = vi.fn();
    render(<TerminalPanel onScrollRequest={onScrollRequest} pane={pane} />);

    const pageUpHandled = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: 'PageUp' }),
    );
    const pageDownHandled = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: 'PageDown' }),
    );

    expect(pageUpHandled).toBe(false);
    expect(pageDownHandled).toBe(false);
    expect(onScrollRequest).toHaveBeenNthCalledWith(1, {
      paneId: 'w1:p2',
      direction: 'up',
      unit: 'page',
      amount: 1,
    });
    expect(onScrollRequest).toHaveBeenNthCalledWith(2, {
      paneId: 'w1:p2',
      direction: 'down',
      unit: 'page',
      amount: 1,
    });
  });
});

describe('TerminalPanel engine reattach', () => {
  it('re-opens the terminal when the engine changes with the same pane id', async () => {
    render(<TerminalPanel pane={pane} />);
    const open = window.herdr.terminal.open as unknown as ReturnType<typeof vi.fn>;
    const before = open.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    sessionEvents.listener?.({ event: 'desktop.engine_changed', data: { generation: 2 } });
    await waitFor(() => expect(open.mock.calls.length).toBeGreaterThan(before));
    expect(open.mock.calls.at(-1)?.[0]).toMatchObject({ paneId: pane.pane_id });
  });

  it('ignores unrelated session events', async () => {
    render(<TerminalPanel pane={pane} />);
    const open = window.herdr.terminal.open as unknown as ReturnType<typeof vi.fn>;
    const before = open.mock.calls.length;
    sessionEvents.listener?.({ event: 'desktop.something_else', data: {} });
    await act(async () => {});
    expect(open.mock.calls.length).toBe(before);
  });
});
