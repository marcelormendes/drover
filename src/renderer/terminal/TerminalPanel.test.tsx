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
  options: undefined as
    | {
        theme?: Record<string, string>;
      }
    | undefined,
  selection: '',
  selectionListener: undefined as (() => void) | undefined,
  rows: 24,
  scrollToBottom: vi.fn(),
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
    constructor(options: { theme?: Record<string, string> }) {
      terminalControl.options = options;
    }
    get cols() {
      return terminalControl.cols;
    }
    get rows() {
      return terminalControl.rows;
    }
    loadAddon() {}
    open() {}
    write() {}
    dispose() {}
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      terminalControl.customKeyHandler = handler;
    }
    hasSelection() {
      return Boolean(terminalControl.selection);
    }
    getSelection() {
      return terminalControl.selection;
    }
    onSelectionChange(listener: () => void) {
      terminalControl.selectionListener = listener;
      return { dispose() {} };
    }
    scrollToBottom = terminalControl.scrollToBottom;
    onData() {
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

describe('TerminalPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalControl.customKeyHandler = undefined;
    terminalControl.cols = 80;
    terminalControl.options = undefined;
    terminalControl.selection = '';
    terminalControl.selectionListener = undefined;
    terminalControl.rows = 24;
    resizeObserver.listener = undefined;
    webLinks.activate = undefined;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
    window.herdr = {
      terminal: {
        open: vi.fn(async () => undefined),
        input: vi.fn(async () => undefined),
        resize: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
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

    expect(terminalControl.options?.theme).toEqual({
      background: '#0f0f10',
      foreground: '#e6e6e6',
      cursor: '#4d9eff',
      cursorAccent: '#0f0f10',
      selectionBackground: '#4d9eff66',
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

  it('opens an accessible terminal search bar', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);

    await user.click(screen.getByRole('button', { name: 'Search terminal' }));

    expect(screen.getByRole('searchbox', { name: 'Search terminal text' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Previous search result' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next search result' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close terminal search' })).toBeInTheDocument();
  });

  it('searches terminal output incrementally as the query changes', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);

    await user.click(screen.getByRole('button', { name: 'Search terminal' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search terminal text' }), 'error');

    expect(searchAddon.findNext).toHaveBeenLastCalledWith(
      'error',
      expect.objectContaining({ incremental: true }),
    );
  });

  it('navigates terminal search results with explicit controls', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);

    await user.click(screen.getByRole('button', { name: 'Search terminal' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search terminal text' }), 'warning');
    searchAddon.findNext.mockClear();

    await user.click(screen.getByRole('button', { name: 'Next search result' }));
    await user.click(screen.getByRole('button', { name: 'Previous search result' }));

    expect(searchAddon.findNext).toHaveBeenCalledWith('warning');
    expect(searchAddon.findPrevious).toHaveBeenCalledWith('warning');
  });

  it('opens terminal search from the focused terminal keyboard', async () => {
    render(<TerminalPanel pane={pane} />);

    expect(terminalControl.customKeyHandler).toEqual(expect.any(Function));
    act(() => {
      terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key: 'f', metaKey: true }));
    });

    expect(screen.getByRole('searchbox', { name: 'Search terminal text' })).toHaveFocus();
  });

  it('uses Enter and Shift+Enter to traverse terminal search results', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);

    await user.click(screen.getByRole('button', { name: 'Search terminal' }));
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

    await user.click(screen.getByRole('button', { name: 'Search terminal' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search terminal text' }), 'done');
    await user.click(screen.getByRole('button', { name: 'Close terminal search' }));

    expect(searchAddon.clearDecorations).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Search terminal' }));
    expect(screen.getByRole('searchbox', { name: 'Search terminal text' })).toHaveValue('');
  });

  it('closes terminal search with Escape', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);

    await user.click(screen.getByRole('button', { name: 'Search terminal' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search terminal text' }), 'closed');
    await user.keyboard('{Escape}');

    expect(
      screen.queryByRole('searchbox', { name: 'Search terminal text' }),
    ).not.toBeInTheDocument();
    expect(searchAddon.clearDecorations).toHaveBeenCalledOnce();
  });

  it('copies the explicit terminal selection and announces success', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<TerminalPanel pane={pane} />);
    terminalControl.selection = 'selected output';
    act(() => terminalControl.selectionListener?.());

    await user.click(screen.getByRole('button', { name: 'Copy terminal selection' }));

    expect(writeText).toHaveBeenCalledWith('selected output');
    expect(screen.getByRole('status')).toHaveTextContent('Selection copied');
  });

  it('announces when copying the terminal selection fails', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error('permission denied'))) },
    });
    render(<TerminalPanel pane={pane} />);
    terminalControl.selection = 'selected output';
    act(() => terminalControl.selectionListener?.());

    await user.click(screen.getByRole('button', { name: 'Copy terminal selection' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Could not copy selection');
  });

  it('copies the terminal selection with Ctrl+Shift+C when a selection exists', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<TerminalPanel pane={pane} />);
    terminalControl.selection = 'selected output';
    act(() => terminalControl.selectionListener?.());

    const intercepted = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, shiftKey: true }),
    );

    expect(intercepted).toBe(false);
    expect(writeText).toHaveBeenCalledWith('selected output');
    expect(await screen.findByRole('status')).toHaveTextContent('Selection copied');
  });

  it('lets plain Ctrl+C pass through to the pane when there is no selection', () => {
    render(<TerminalPanel pane={pane} />);
    terminalControl.selection = '';

    const intercepted = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }),
    );

    expect(intercepted).toBe(true);
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

  it('scrolls the terminal viewport to the latest output', async () => {
    const user = userEvent.setup();
    render(<TerminalPanel pane={pane} />);

    await user.click(screen.getByRole('button', { name: 'Scroll terminal to bottom' }));

    expect(terminalControl.scrollToBottom).toHaveBeenCalledOnce();
  });

  it('emits engine-backed line scrolling from terminal wheel direction', () => {
    const onScrollRequest = vi.fn();
    render(<TerminalPanel onScrollRequest={onScrollRequest} pane={pane} />);
    const terminal = screen.getByRole('region', { name: 'Terminal output w1:p2' });

    fireEvent.wheel(terminal, { deltaY: -120 });
    fireEvent.wheel(terminal, { deltaY: 120 });

    expect(onScrollRequest).toHaveBeenNthCalledWith(1, {
      paneId: 'w1:p2',
      direction: 'up',
      unit: 'line',
      amount: 1,
    });
    expect(onScrollRequest).toHaveBeenNthCalledWith(2, {
      paneId: 'w1:p2',
      direction: 'down',
      unit: 'line',
      amount: 1,
    });
  });

  it('emits engine-backed page scrolling from explicit controls', async () => {
    const user = userEvent.setup();
    const onScrollRequest = vi.fn();
    render(<TerminalPanel onScrollRequest={onScrollRequest} pane={pane} />);

    await user.click(screen.getByRole('button', { name: 'Scroll terminal one page up' }));
    await user.click(screen.getByRole('button', { name: 'Scroll terminal one page down' }));

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
