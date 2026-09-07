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
import type { HerdrQuery, HerdrQueryResult } from '@/shared/desktop-api';
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

function searchPage(
  query: string,
  matchIndex: number | null = 0,
  matchCount = 3,
): Extract<HerdrQueryResult, { type: 'pane-search' }> {
  return {
    type: 'pane-search',
    paneId: pane.pane_id,
    terminalId: pane.terminal_id,
    query,
    caseSensitive: false,
    matchCount,
    matchIndex,
    cursor: matchIndex === null ? null : `cursor-${matchIndex}`,
    preview: matchIndex === null ? null : `retained history: ${query}`,
  };
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
      command: vi.fn(async () => ({ state: 'connected' })),
      query: vi.fn(async (request: HerdrQuery) =>
        request.type === 'search-pane-output'
          ? searchPage(request.query)
          : { type: 'plugin-list', plugins: [] },
      ),
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

      expect(screen.getByRole('searchbox', { name: 'Search terminal history' })).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Previous search result' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next search result' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close terminal search' })).toBeInTheDocument();
      expect(screen.getByText('Search retained terminal history.')).toBeVisible();
    },
  );

  it('debounces typing and displays the engine match count and retained-line preview', async () => {
    render(<TerminalPanel pane={pane} />);
    openTerminalSearch();
    const input = screen.getByRole('searchbox', { name: 'Search terminal history' });
    fireEvent.change(input, { target: { value: 'ear' } });
    fireEvent.change(input, { target: { value: 'earlier' } });
    expect(window.herdr.query).not.toHaveBeenCalled();
    expect(screen.getByRole('status', { name: 'Terminal search status' })).toHaveTextContent(
      'Searching…',
    );
    expect(await screen.findByText('1 of 3 matches')).toBeVisible();
    expect(window.herdr.query).toHaveBeenCalledExactlyOnceWith({
      type: 'search-pane-output',
      paneId: 'w1:p2',
      terminalId: 'terminal-2',
      query: 'earlier',
      caseSensitive: false,
      direction: 'first',
    });
    expect(screen.getByLabelText('Selected terminal match')).toHaveTextContent(
      'retained history: earlier',
    );
  });

  it('delegates wrapping and fresh next/previous searches using engine cursors', async () => {
    vi.mocked(window.herdr.query)
      .mockResolvedValueOnce(searchPage('find', 2))
      .mockResolvedValueOnce(searchPage('find', 0))
      .mockResolvedValueOnce(searchPage('find', 2));
    render(<TerminalPanel pane={pane} />);
    openTerminalSearch();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'find' } });
    await screen.findByText('3 of 3 matches');
    fireEvent.click(screen.getByRole('button', { name: 'Next search result' }));
    await screen.findByText('1 of 3 matches');
    expect(window.herdr.query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ direction: 'next', cursor: 'cursor-2' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous search result' }));
    await screen.findByText('3 of 3 matches');
    expect(window.herdr.query).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ direction: 'previous', cursor: 'cursor-0' }),
    );
  });

  it('uses Enter immediately and Shift+Enter for the previous match', async () => {
    render(<TerminalPanel pane={pane} />);
    openTerminalSearch();
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'find' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('1 of 3 matches');
    expect(window.herdr.query).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ direction: 'next' }),
    );
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(window.herdr.query).toHaveBeenCalledTimes(2));
    expect(window.herdr.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ direction: 'previous', cursor: 'cursor-0' }),
    );
  });

  it('serializes searches, coalesces waiting queries, and discards stale results', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (result: HerdrQueryResult) => void;
      vi.mocked(window.herdr.query).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      render(<TerminalPanel pane={pane} />);
      openTerminalSearch();
      const input = screen.getByRole('searchbox');
      fireEvent.change(input, { target: { value: 'old' } });
      await act(async () => vi.advanceTimersByTime(200));
      fireEvent.change(input, { target: { value: 'middle' } });
      await act(async () => vi.advanceTimersByTime(200));
      fireEvent.change(input, { target: { value: 'latest' } });
      await act(async () => vi.advanceTimersByTime(200));
      expect(window.herdr.query).toHaveBeenCalledTimes(1);
      await act(async () => finish(searchPage('old')));
      expect(window.herdr.query).toHaveBeenCalledTimes(2);
      expect(window.herdr.query).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'latest', direction: 'first' }),
      );
      expect(screen.getByLabelText('Selected terminal match')).toHaveTextContent(
        'retained history: latest',
      );
      expect(screen.queryByText('retained history: old')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['close', 'replace'] as const)(
    'discards an in-flight result on %s and resets query/cursor',
    async (action) => {
      let finish!: (result: HerdrQueryResult) => void;
      vi.mocked(window.herdr.query).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const view = render(<TerminalPanel pane={pane} />);
      openTerminalSearch();
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'old' } });
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
      await waitFor(() => expect(window.herdr.query).toHaveBeenCalledOnce());
      if (action === 'close') {
        fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
        expect(terminalControl.focus).toHaveBeenCalledOnce();
      } else view.rerender(<TerminalPanel pane={{ ...pane, terminal_id: 'replacement' }} />);
      await act(async () => finish(searchPage('old')));
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
      openTerminalSearch();
      expect(screen.getByRole('searchbox')).toHaveValue('');
      expect(screen.queryByText('1 of 3 matches')).not.toBeInTheDocument();
      if (action === 'replace') {
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'new' } });
        fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
        await waitFor(() => expect(window.herdr.query).toHaveBeenCalledTimes(2));
        expect(window.herdr.query).toHaveBeenLastCalledWith(
          expect.objectContaining({ terminalId: 'replacement', query: 'new' }),
        );
        expect(vi.mocked(window.herdr.query).mock.calls[1][0]).not.toHaveProperty('cursor');
      }
    },
  );

  it('shows no matches and cancels a waiting search when cleared or closed', async () => {
    vi.mocked(window.herdr.query).mockResolvedValue(searchPage('absent', null, 0));
    render(<TerminalPanel pane={pane} />);
    openTerminalSearch();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } });
    expect(await screen.findByText('No matches')).toBeVisible();
    expect(screen.queryByLabelText('Selected terminal match')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Next search result' })).toBeDisabled();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cancelled' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal search' }));
    expect(terminalControl.focus).toHaveBeenCalledOnce();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it.each([
    ['unknown method pane.search', 'Update Herdr to search terminal history.'],
    ['Connection timed out.', 'Connection timed out.'],
  ])('shows a precise search error for %s', async (error, expected) => {
    vi.mocked(window.herdr.query).mockRejectedValue(new Error(error));
    render(<TerminalPanel pane={pane} />);
    openTerminalSearch();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'find' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen.queryByText('No matches')).not.toBeInTheDocument();
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

  it('pastes literal multiline text through Herdr so the real PTY controls bracketing', async () => {
    const text = 'printf first\nprintf second';
    vi.mocked(window.herdr.terminal.readClipboard).mockResolvedValueOnce(text);
    render(<TerminalPanel pane={pane} />);
    act(() => {
      terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key: 'v', metaKey: true }));
    });
    await waitFor(() =>
      expect(window.herdr.command).toHaveBeenCalledExactlyOnceWith({
        type: 'send-pane-input',
        paneId: 'w1:p2',
        text,
      }),
    );
    expect(terminalControl.paste).not.toHaveBeenCalled();
    expect(window.herdr.terminal.input).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Clipboard pasted');
  });

  it('delivers an asynchronous clipboard paste before the immediately following Return', async () => {
    let finishClipboard!: (text: string) => void;
    let finishPaste!: () => void;
    vi.mocked(window.herdr.terminal.readClipboard).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishClipboard = resolve;
        }),
    );
    vi.mocked(window.herdr.command).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPaste = () => resolve({ state: 'connected' } as never);
        }),
    );
    render(<TerminalPanel pane={pane} />);
    act(() => {
      terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key: 'v', metaKey: true }));
      terminalControl.dataListener?.('\r');
    });
    expect(window.herdr.terminal.input).not.toHaveBeenCalled();
    await act(async () => finishClipboard('COPY_PASTE_OK'));
    expect(window.herdr.command).toHaveBeenCalledExactlyOnceWith({
      type: 'send-pane-input',
      paneId: 'w1:p2',
      text: 'COPY_PASTE_OK',
    });
    expect(window.herdr.terminal.input).not.toHaveBeenCalled();
    await act(async () => finishPaste());
    expect(window.herdr.terminal.input).toHaveBeenCalledExactlyOnceWith({
      paneId: 'w1:p2',
      text: '\r',
    });
  });

  it('preserves key order across multiple clipboard reads that finish out of order', async () => {
    const reads: Array<(text: string) => void> = [];
    const delivered: string[] = [];
    vi.mocked(window.herdr.terminal.readClipboard).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push(resolve);
        }),
    );
    vi.mocked(window.herdr.command).mockImplementation(async (command) => {
      if (command.type === 'send-pane-input') delivered.push(command.text ?? '');
      return { state: 'connected' } as never;
    });
    vi.mocked(window.herdr.terminal.input).mockImplementation(async ({ text }) => {
      delivered.push(text);
    });
    render(<TerminalPanel pane={pane} />);
    act(() => {
      terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key: 'v', metaKey: true }));
      terminalControl.dataListener?.('1');
      terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key: 'v', metaKey: true }));
      terminalControl.dataListener?.('2');
    });
    expect(reads).toHaveLength(2);
    await act(async () => reads[1]('second'));
    expect(delivered).toEqual([]);
    await act(async () => reads[0]('first'));
    expect(delivered).toEqual(['first', '1', 'second', '2']);
  });

  it('discards pending paste and deferred input when the terminal changes panes', async () => {
    let finishClipboard!: (text: string) => void;
    vi.mocked(window.herdr.terminal.readClipboard).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishClipboard = resolve;
        }),
    );
    const view = render(<TerminalPanel pane={pane} />);
    act(() => {
      terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key: 'v', metaKey: true }));
      terminalControl.dataListener?.('\r');
    });
    view.rerender(<TerminalPanel pane={{ ...pane, pane_id: 'w1:p3' }} />);
    await act(async () => finishClipboard('old pane text'));
    expect(window.herdr.command).not.toHaveBeenCalled();
    expect(window.herdr.terminal.input).not.toHaveBeenCalled();
    act(() => terminalControl.dataListener?.('new pane input'));
    expect(window.herdr.terminal.input).toHaveBeenCalledExactlyOnceWith({
      paneId: 'w1:p3',
      text: 'new pane input',
    });
  });

  it('reports a failed clipboard read and releases following input', async () => {
    let failClipboard!: (reason: Error) => void;
    vi.mocked(window.herdr.terminal.readClipboard).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failClipboard = reject;
        }),
    );
    render(<TerminalPanel pane={pane} />);
    act(() => {
      terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key: 'v', metaKey: true }));
      terminalControl.dataListener?.('after failure');
    });
    await act(async () => failClipboard(new Error('clipboard unavailable')));
    expect(screen.getByRole('status')).toHaveTextContent('Could not paste clipboard');
    expect(window.herdr.command).not.toHaveBeenCalled();
    expect(window.herdr.terminal.input).toHaveBeenCalledExactlyOnceWith({
      paneId: 'w1:p2',
      text: 'after failure',
    });
  });

  it('does not announce success when the engine rejects a paste', async () => {
    vi.mocked(window.herdr.terminal.readClipboard).mockResolvedValueOnce('clipboard');
    vi.mocked(window.herdr.command).mockResolvedValueOnce({
      state: 'error',
      message: 'pane unavailable',
    });
    render(<TerminalPanel pane={pane} />);
    act(() => {
      terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key: 'v', metaKey: true }));
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Could not paste clipboard');
  });

  it('pastes with Ctrl+Shift+V', async () => {
    vi.mocked(window.herdr.terminal.readClipboard).mockResolvedValueOnce('shortcut paste');
    render(<TerminalPanel pane={pane} />);
    const intercepted = terminalControl.customKeyHandler?.(
      new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true }),
    );
    expect(intercepted).toBe(false);
    await waitFor(() =>
      expect(window.herdr.command).toHaveBeenCalledWith({
        type: 'send-pane-input',
        paneId: 'w1:p2',
        text: 'shortcut paste',
      }),
    );
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
        modifiers: 0,
      }),
    );
    expect(onScrollRequest).toHaveBeenCalledOnce();
  });

  it('forwards coalesced wheel coordinates and modifiers from the terminal screen', async () => {
    const onScrollRequest = vi.fn();
    render(<TerminalPanel onScrollRequest={onScrollRequest} pane={pane} />);
    const terminal = screen.getByRole('region', { name: 'Terminal output w1:p2' });
    const screenElement = document.createElement('div');
    screenElement.className = 'xterm-screen';
    terminal.append(screenElement);
    vi.spyOn(screenElement, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      top: 10,
      width: 800,
      height: 240,
    } as DOMRect);
    // happy-dom's WheelEvent omits inherited mouse fields; supply the native
    // browser fields explicitly so this exercises React's wheel normalization.
    const wheelAt = (clientX: number, clientY: number, shiftKey = false, altKey = false) => {
      const event = new WheelEvent('wheel', { deltaY: 40, bubbles: true });
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        shiftKey: { value: shiftKey },
        altKey: { value: altKey },
      });
      fireEvent(terminal, event);
    };
    wheelAt(120, 20);
    wheelAt(320, 60, true, true);
    await waitFor(() =>
      expect(onScrollRequest).toHaveBeenCalledExactlyOnceWith({
        paneId: 'w1:p2',
        direction: 'down',
        unit: 'line',
        amount: 2,
        column: 30,
        row: 5,
        modifiers: 5,
      }),
    );
  });

  it('retains sub-line wheel motion across frames and resets it on pane replacement', () => {
    const onScrollRequest = vi.fn();
    const view = render(<TerminalPanel onScrollRequest={onScrollRequest} pane={pane} />);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const terminal = screen.getByRole('region', { name: 'Terminal output w1:p2' });
    const flushFrame = () =>
      act(() => {
        for (const callback of frames.splice(0)) callback(0);
      });
    fireEvent.wheel(terminal, { deltaY: 10 });
    flushFrame();
    expect(onScrollRequest).not.toHaveBeenCalled();
    fireEvent.wheel(terminal, { deltaY: 30 });
    flushFrame();
    expect(onScrollRequest).toHaveBeenCalledExactlyOnceWith({
      paneId: 'w1:p2',
      direction: 'down',
      unit: 'line',
      amount: 1,
      modifiers: 0,
    });
    onScrollRequest.mockClear();
    fireEvent.wheel(terminal, { deltaY: 20 });
    flushFrame();
    view.rerender(
      <TerminalPanel onScrollRequest={onScrollRequest} pane={{ ...pane, pane_id: 'w1:p3' }} />,
    );
    fireEvent.wheel(screen.getByRole('region', { name: 'Terminal output w1:p3' }), { deltaY: 20 });
    flushFrame();
    expect(onScrollRequest).not.toHaveBeenCalled();
  });

  it('leaves modified PageUp and PageDown for xterm to encode', () => {
    const onScrollRequest = vi.fn();
    render(<TerminalPanel onScrollRequest={onScrollRequest} pane={pane} />);
    for (const key of ['PageUp', 'PageDown']) {
      for (const modifiers of [
        { ctrlKey: true },
        { shiftKey: true },
        { altKey: true },
        { metaKey: true },
      ]) {
        expect(
          terminalControl.customKeyHandler?.(new KeyboardEvent('keydown', { key, ...modifiers })),
        ).toBe(true);
      }
    }
    expect(onScrollRequest).not.toHaveBeenCalled();
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
