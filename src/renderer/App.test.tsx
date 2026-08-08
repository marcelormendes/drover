import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/chat/ChatPanel', async () => {
  const { useState } = await import('react');
  return {
    createChatSessionState: () => ({
      draft: '',
      transcript: { messages: [], activeTurnId: null, liveResponseId: null },
    }),
    ChatPanel: ({
      pane,
      onPrompt,
      onSessionChange,
      session,
    }: {
      pane: { display_agent?: string; pane_id: string };
      onPrompt: (target: string, text: string) => void | Promise<void>;
      onSessionChange?: (update: (current: { draft: string }) => { draft: string }) => void;
      session?: { draft: string };
    }) => {
      const [promptOutcome, setPromptOutcome] = useState('pending');
      return (
        <div data-testid={`chat-${pane.pane_id}`}>
          Chat with {pane.display_agent}
          <span>{session?.draft}</span>
          <button
            onClick={() => {
              setPromptOutcome('pending');
              void Promise.resolve(onPrompt(pane.pane_id, 'Ship the chat'))
                .then(() => setPromptOutcome('resolved'))
                .catch(() => setPromptOutcome('rejected'));
            }}
            type="button"
          >
            Test send chat
          </button>
          <span data-testid="prompt-outcome">{promptOutcome}</span>
          <button
            onClick={() =>
              onSessionChange?.((current) => ({ ...current, draft: 'Preserved turn' }))
            }
            type="button"
          >
            Test preserve chat
          </button>
        </div>
      );
    },
  };
});

vi.mock('@/renderer/terminal/TerminalPanel', () => ({
  TerminalPanel: ({
    pane,
    onScrollRequest,
  }: {
    pane: { label?: string; pane_id: string };
    onScrollRequest?: (request: {
      paneId: string;
      direction: 'up' | 'down';
      unit: 'line' | 'page';
      amount: number;
    }) => void;
  }) => (
    <div data-testid={`terminal-${pane.pane_id}`}>
      {pane.label || pane.pane_id}
      <button
        onClick={() =>
          onScrollRequest?.({
            paneId: pane.pane_id,
            direction: 'up',
            unit: 'page',
            amount: 1,
          })
        }
        type="button"
      >
        Test canonical scroll
      </button>
    </div>
  ),
}));

import { App } from '@/renderer/App';
import type { DesktopAction, HerdrQueryResult } from '@/shared/desktop-api';
import type { EngineBootstrap, SessionSnapshot } from '@/shared/herdr';
import { DEFAULT_DESKTOP_PREFERENCES } from '@/shared/preferences';
import packageMetadata from '../../package.json';

const snapshot: SessionSnapshot = {
  version: '0.8.0',
  protocol: 7,
  focused_workspace_id: 'w1',
  focused_tab_id: 'w1:t1',
  focused_pane_id: 'w1:p1',
  workspaces: [
    {
      workspace_id: 'w1',
      number: 1,
      label: 'herdr-desktop',
      focused: true,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: 'w1:t1',
      agent_status: 'working',
      tokens: {},
    },
    {
      workspace_id: 'w2',
      number: 2,
      label: 'release-notes',
      focused: false,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: 'w2:t1',
      agent_status: 'idle',
      tokens: {},
    },
  ],
  tabs: [
    {
      tab_id: 'w1:t1',
      workspace_id: 'w1',
      number: 1,
      label: 'implementation',
      focused: true,
      pane_count: 1,
      agent_status: 'working',
    },
    {
      tab_id: 'w2:t1',
      workspace_id: 'w2',
      number: 1,
      label: 'editorial',
      focused: false,
      pane_count: 1,
      agent_status: 'idle',
    },
  ],
  panes: [
    {
      pane_id: 'w1:p1',
      terminal_id: 'terminal-1',
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      focused: true,
      cwd: '/code/herdr-desktop',
      label: 'Desktop UI',
      display_agent: 'Codex',
      agent_status: 'working',
      state_labels: {},
      tokens: {},
      revision: 1,
    },
    {
      pane_id: 'w2:p1',
      terminal_id: 'terminal-2',
      workspace_id: 'w2',
      tab_id: 'w2:t1',
      focused: false,
      cwd: '/code/release-notes',
      label: 'Notes',
      agent_status: 'idle',
      state_labels: {},
      tokens: {},
      revision: 1,
    },
  ],
  layouts: [],
  agents: [
    {
      terminal_id: 'terminal-1',
      name: 'builder',
      agent: 'codex',
      display_agent: 'Codex',
      agent_status: 'working',
      screen_detection_skipped: false,
      state_labels: { phase: 'implementing' },
      tokens: {},
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      pane_id: 'w1:p1',
      focused: true,
      launch_pending: false,
      interactive_ready: true,
      state_change_seq: 1,
      cwd: '/code/herdr-desktop',
      revision: 1,
    },
  ],
};

const connected: EngineBootstrap = {
  state: 'connected',
  status: {
    client: {
      version: '0.8.0',
      channel: 'stable',
      protocol: 7,
      binary: '/usr/local/bin/herdr',
      session: 'default',
    },
    server: {
      status: 'running',
      running: true,
      version: '0.8.0',
      protocol: 7,
      capabilities: { live_handoff: true, detached_server_daemon: true },
      compatible: true,
      socket: '/tmp/herdr.sock',
      session: 'default',
      restart_needed: false,
    },
    update: { restart_needed: false },
  },
  snapshot,
};

describe('App', () => {
  beforeEach(() => {
    window.herdr = {
      bootstrap: vi.fn(async () => connected),
      startServer: vi.fn(async () => connected),
      command: vi.fn(async () => connected),
      query: vi.fn(async () => ({ type: 'plugin-list' as const, plugins: [] })),
      stageChatImages: vi.fn(async () => []),
      readPreferences: vi.fn(async () => DEFAULT_DESKTOP_PREFERENCES),
      writePreferences: vi.fn(async (preferences) => preferences),
      chooseHerdrBinary: vi.fn(async () => connected),
      resetHerdrBinary: vi.fn(async () => connected),
      engineUpdate: vi.fn(async () => ({
        bootstrap: connected,
        updated: false,
        version: '0.8.0',
        message: 'Herdr engine is already up to date (v0.8.0).',
      })),
      checkDesktopUpdate: vi.fn(async () => ({
        currentVersion: packageMetadata.version,
        latestVersion: packageMetadata.version,
        updateAvailable: false,
        releaseUrl: 'https://github.com/marcelormendes/herdr-desktop/releases/latest',
      })),
      applyRemoteEngine: vi.fn(async (target) => ({
        state: 'off' as const,
        host: target.host,
        port: target.port,
      })),
      remoteEngineStatus: vi.fn(async () => ({
        state: 'off' as const,
        host: '',
        port: 22025,
      })),
      onDesktopAction: vi.fn(() => () => undefined),
      onSessionEvent: vi.fn(() => () => undefined),
      terminal: {
        open: vi.fn(async () => undefined),
        input: vi.fn(async () => undefined),
        resize: vi.fn(async () => undefined),
        scroll: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        onEvent: vi.fn(() => () => undefined),
      },
      openExternal: vi.fn(async () => undefined),
    };
  });

  it('renders Herdr-owned workspaces, tabs, and the focused pane', async () => {
    const { container } = render(<App />);

    expect(screen.getByText('Connecting to Herdr')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'herdr-desktop' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /implementation/i })).toBeInTheDocument();
    expect(screen.getAllByText('Desktop UI')).not.toHaveLength(0);
    expect(screen.getByText('Engine connected')).toBeInTheDocument();

    const workspaceHeader = screen.getByText('spaces').parentElement;
    expect(container.querySelector('[data-slot="session-shell"]')).toHaveStyle({
      '--spaces-width': '280px',
    });
    expect(workspaceHeader).toHaveClass('gap-2', 'px-3');
    // Agents live under spaces in one rail, matching the Herdr TUI.
    const rail = screen.getByText('spaces').closest('aside');
    expect(screen.getByText('agents').closest('aside')).toBe(rail);
    expect(container.querySelector('[data-slot="app-mark"]')).toHaveClass(
      'shrink-0',
      'shadow-none',
      'text-main-foreground',
    );

    const tabActions = container.querySelector('[data-slot="tab-actions"]');
    expect(tabActions).toHaveClass('ml-2', 'flex', 'items-center', 'gap-1');
    expect(screen.getByRole('button', { name: 'New tab' })).not.toHaveClass('ml-2');
    expect(screen.getByRole('button', { name: 'Tab actions' })).not.toHaveClass('ml-2');
  });

  it('uses chat as the default agent surface and keeps terminal as a lazy fallback', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByTestId('chat-w1:p1')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-w1:p1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chat view' })).toHaveClass('text-main-foreground');
    await user.click(screen.getByRole('button', { name: 'Terminal view' }));
    expect(screen.getByTestId('terminal-w1:p1')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-w1:p1')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Chat view' }));
    expect(screen.getByTestId('chat-w1:p1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Test send chat' }));
    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'prompt-agent',
      target: 'w1:p1',
      text: 'Ship the chat',
    });
    await waitFor(() => expect(screen.getByTestId('prompt-outcome')).toHaveTextContent('resolved'));
  });

  it('rejects the chat prompt promise when the engine command fails', async () => {
    const user = userEvent.setup();
    const command = vi.mocked(window.herdr.command);
    command.mockImplementation(async (candidate) => {
      if (candidate.type === 'prompt-agent') {
        throw new Error('engine busy');
      }
      return connected;
    });
    render(<App />);
    await screen.findByTestId('chat-w1:p1');

    await user.click(screen.getByRole('button', { name: 'Test send chat' }));

    expect(command).toHaveBeenCalledWith({
      type: 'prompt-agent',
      target: 'w1:p1',
      text: 'Ship the chat',
    });
    await waitFor(() => expect(screen.getByTestId('prompt-outcome')).toHaveTextContent('rejected'));
  });

  it('focuses canonical workspace records through the Herdr engine', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /release-notes/i }));

    expect(screen.getByRole('heading', { name: 'release-notes' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /editorial/i })).toBeInTheDocument();
    expect(screen.getAllByText('Notes')).not.toHaveLength(0);
    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'focus-workspace',
      workspaceId: 'w2',
    });
  });

  it('preserves each pane chat session across workspace navigation', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('chat-w1:p1');

    await user.click(screen.getByRole('button', { name: 'Test preserve chat' }));
    expect(screen.getByText('Preserved turn')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /release-notes/i }));
    expect(screen.queryByTestId('chat-w1:p1')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /herdr-desktop/i }));

    expect(await screen.findByText('Preserved turn')).toBeInTheDocument();
  });

  it('creates a workspace through a Neobrutalism dialog and the Herdr engine', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New workspace' }));
    await user.type(screen.getByLabelText('Working directory'), '/code/new-project');
    await user.type(screen.getByLabelText('Workspace label'), 'New project');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'create-workspace',
      cwd: '/code/new-project',
      label: 'New project',
    });
  });

  it('creates a worktree workspace from an ordinary active workspace', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New worktree' }));
    await user.type(screen.getByLabelText('Branch name'), 'feature/chat-images');
    await user.click(screen.getByRole('button', { name: 'Create worktree' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'create-worktree',
      workspaceId: 'w1',
      branch: 'feature/chat-images',
      path: undefined,
      label: undefined,
      focus: true,
    });
  });

  it('keeps a newly created worktree focused when an older background refresh finishes', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    let resolveStaleRefresh: ((result: EngineBootstrap) => void) | undefined;
    const staleRefresh = new Promise<EngineBootstrap>((resolve) => {
      resolveStaleRefresh = resolve;
    });
    const reviewerPane = {
      ...snapshot.panes[0],
      pane_id: 'w1:p2',
      terminal_id: 'terminal-reviewer',
      label: 'Reviewer',
      display_agent: undefined,
      focused: false,
    };
    const reviewerSnapshot: SessionSnapshot = {
      ...snapshot,
      workspaces: snapshot.workspaces.map((workspace) =>
        workspace.workspace_id === 'w1' ? { ...workspace, pane_count: 2 } : workspace,
      ),
      tabs: snapshot.tabs.map((tab) => (tab.tab_id === 'w1:t1' ? { ...tab, pane_count: 2 } : tab)),
      panes: [...snapshot.panes, reviewerPane],
    };
    const reviewerResult: EngineBootstrap = { ...connected, snapshot: reviewerSnapshot };
    const worktreeSnapshot: SessionSnapshot = {
      ...reviewerSnapshot,
      focused_workspace_id: 'w3',
      focused_tab_id: 'w3:t1',
      focused_pane_id: 'w3:p1',
      workspaces: [
        ...reviewerSnapshot.workspaces.map((workspace) => ({ ...workspace, focused: false })),
        {
          workspace_id: 'w3',
          number: 3,
          label: 'bug-reviewer',
          focused: true,
          pane_count: 1,
          tab_count: 1,
          active_tab_id: 'w3:t1',
          agent_status: 'working',
          tokens: {},
        },
      ],
      tabs: [
        ...reviewerSnapshot.tabs.map((tab) => ({ ...tab, focused: false })),
        {
          tab_id: 'w3:t1',
          workspace_id: 'w3',
          number: 1,
          label: '1',
          focused: true,
          pane_count: 1,
          agent_status: 'working',
        },
      ],
      panes: [
        ...reviewerSnapshot.panes.map((pane) => ({ ...pane, focused: false })),
        {
          ...snapshot.panes[0],
          pane_id: 'w3:p1',
          terminal_id: 'terminal-worktree',
          workspace_id: 'w3',
          tab_id: 'w3:t1',
          cwd: '/worktrees/bug-reviewer',
          label: 'Worktree agent',
          focused: true,
        },
      ],
    };
    const worktreeResult: EngineBootstrap = { ...connected, snapshot: worktreeSnapshot };
    window.herdr.bootstrap = vi
      .fn<() => Promise<EngineBootstrap>>()
      .mockResolvedValueOnce(reviewerResult)
      .mockReturnValueOnce(staleRefresh)
      .mockResolvedValue(worktreeResult);
    window.herdr.command = vi.fn(async (command) =>
      command.type === 'create-worktree' ? worktreeResult : reviewerResult,
    );
    window.herdr.onSessionEvent = vi.fn((listener) => {
      sessionEvent = listener;
      return () => undefined;
    });

    vi.useFakeTimers();
    try {
      render(<App />);
      await act(async () => {});
      expect(screen.getByRole('heading', { name: 'herdr-desktop' })).toBeInTheDocument();
      expect(screen.getAllByText('Reviewer')).not.toHaveLength(0);

      act(() => sessionEvent?.({ event: 'layout.updated', data: {} }));
      act(() => vi.advanceTimersByTime(1_000));
      await act(async () => {});
      expect(window.herdr.bootstrap).toHaveBeenCalledTimes(2);

      fireEvent.click(screen.getByRole('button', { name: 'New worktree' }));
      fireEvent.change(screen.getByLabelText('Branch name'), {
        target: { value: 'bug-reviewer' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Create worktree' }));
      await act(async () => {});
      expect(screen.getByRole('heading', { name: 'bug-reviewer' })).toBeInTheDocument();
      expect(screen.queryAllByText('Reviewer')).toHaveLength(0);

      await act(async () => resolveStaleRefresh?.(reviewerResult));

      expect(screen.getByRole('heading', { name: 'bug-reviewer' })).toBeInTheDocument();
      expect(screen.queryAllByText('Reviewer')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates another worktree from the repository root when a linked workspace is active', async () => {
    window.herdr.bootstrap = vi.fn(async () => ({
      ...connected,
      snapshot: {
        ...snapshot,
        focused_workspace_id: 'w2',
        focused_tab_id: 'w2:t1',
        focused_pane_id: 'w2:p1',
        workspaces: [
          {
            ...snapshot.workspaces[0],
            focused: false,
            worktree: {
              repo_key: 'repo-1',
              repo_name: 'herdr-desktop',
              repo_root: '/code/herdr-desktop',
              checkout_path: '/code/herdr-desktop',
              is_linked_worktree: false,
            },
          },
          {
            ...snapshot.workspaces[1],
            focused: true,
            worktree: {
              repo_key: 'repo-1',
              repo_name: 'herdr-desktop',
              repo_root: '/code/herdr-desktop',
              checkout_path: '/worktrees/release-notes',
              is_linked_worktree: true,
            },
          },
        ],
      },
    }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New worktree' }));
    await user.type(screen.getByLabelText('Branch name'), 'feature/another-worktree');
    await user.click(screen.getByRole('button', { name: 'Create worktree' }));

    expect(window.herdr.command).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'create-worktree',
        workspaceId: 'w1',
      }),
    );
  });

  it('can create the first workspace without falling back to the terminal', async () => {
    window.herdr.bootstrap = vi.fn(async () => ({
      ...connected,
      snapshot: {
        ...snapshot,
        focused_workspace_id: undefined,
        focused_tab_id: undefined,
        focused_pane_id: undefined,
        workspaces: [],
        tabs: [],
        panes: [],
      },
    }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New workspace' }));
    await user.type(screen.getByLabelText('Working directory'), '/code/first');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'create-workspace',
      cwd: '/code/first',
      label: undefined,
    });
  });

  it('creates tabs and splits the focused pane through Herdr', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New tab' }));
    await user.type(screen.getByLabelText('Tab label'), 'tests');
    await user.click(screen.getByRole('button', { name: 'Create tab' }));
    await user.click(screen.getByRole('button', { name: 'Split pane right' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'create-tab',
      workspaceId: 'w1',
      label: 'tests',
    });
    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'split-pane',
      paneId: 'w1:p1',
      direction: 'right',
    });
  });

  it('renders every pane using Herdr canonical layout rectangles', async () => {
    window.herdr.bootstrap = vi.fn(async () => ({
      ...connected,
      snapshot: {
        ...snapshot,
        panes: [
          snapshot.panes[0],
          {
            ...snapshot.panes[0],
            pane_id: 'w1:p2',
            terminal_id: 'terminal-2',
            label: 'Tests',
            focused: false,
          },
        ],
        layouts: [
          {
            workspace_id: 'w1',
            tab_id: 'w1:t1',
            zoomed: false,
            area: { x: 0, y: 0, width: 120, height: 40 },
            focused_pane_id: 'w1:p1',
            panes: [
              { pane_id: 'w1:p1', focused: true, rect: { x: 0, y: 0, width: 60, height: 40 } },
              {
                pane_id: 'w1:p2',
                focused: false,
                rect: { x: 60, y: 0, width: 60, height: 40 },
              },
            ],
            splits: [],
          },
        ],
      },
    }));

    render(<App />);

    expect(await screen.findByTestId('chat-w1:p1')).toBeInTheDocument();
    expect(screen.getByTestId('chat-w1:p2')).toBeInTheDocument();
  });

  it('shows only the engine-focused pane when Herdr marks a tab as zoomed', async () => {
    window.herdr.bootstrap = vi.fn(async () => ({
      ...connected,
      snapshot: {
        ...snapshot,
        layouts: [
          {
            workspace_id: 'w1',
            tab_id: 'w1:t1',
            zoomed: true,
            focused_pane_id: 'w1:p1',
            area: { x: 0, y: 0, width: 100, height: 50 },
            panes: [
              { pane_id: 'w1:p1', focused: true, rect: { x: 0, y: 0, width: 50, height: 50 } },
              { pane_id: 'w1:p2', focused: false, rect: { x: 50, y: 0, width: 50, height: 50 } },
            ],
            splits: [],
          },
        ],
        panes: [
          snapshot.panes[0],
          {
            ...snapshot.panes[0],
            pane_id: 'w1:p2',
            terminal_id: 'terminal-2',
            focused: false,
            label: 'Second pane',
          },
        ],
      },
    }));
    render(<App />);

    expect(await screen.findByTestId('chat-w1:p1')).toBeInTheDocument();
    expect(screen.getByTestId('chat-w1:p2').closest('.absolute')).toHaveClass('hidden');
    expect(screen.getByRole('button', { name: 'Exit pane zoom' })).toBeInTheDocument();
  });

  it('renames and closes workspaces through explicit engine lifecycle actions', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Workspace actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename workspace' }));
    const name = screen.getByLabelText('Workspace name');
    await user.clear(name);
    await user.type(name, 'Desktop core');
    await user.click(screen.getByRole('button', { name: 'Save workspace name' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'rename-workspace',
      workspaceId: 'w1',
      label: 'Desktop core',
    });

    await user.click(screen.getByRole('button', { name: 'Workspace actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close workspace' }));
    await user.click(screen.getByRole('button', { name: 'Close workspace' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'close-workspace',
      workspaceId: 'w1',
    });
  });

  it('manages the active tab and pane without terminal commands', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Tab actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename tab' }));
    const tabName = screen.getByLabelText('Tab name');
    await user.clear(tabName);
    await user.type(tabName, 'build');
    await user.click(screen.getByRole('button', { name: 'Save tab name' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'rename-tab',
      tabId: 'w1:t1',
      label: 'build',
    });

    await user.click(screen.getByRole('button', { name: 'Zoom pane' }));
    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'zoom-pane',
      paneId: 'w1:p1',
      mode: 'toggle',
    });

    await user.click(screen.getByRole('button', { name: 'Pane actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename pane' }));
    const paneName = screen.getByLabelText('Pane name');
    await user.clear(paneName);
    await user.type(paneName, 'Review');
    await user.click(screen.getByRole('button', { name: 'Save pane name' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'rename-pane',
      paneId: 'w1:p1',
      label: 'Review',
    });

    await user.click(screen.getByRole('button', { name: 'Pane actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close pane' }));
    await user.click(screen.getByRole('button', { name: 'Close pane' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'close-pane',
      paneId: 'w1:p1',
    });
  });

  it('starts a supported agent in the focused Herdr pane', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Launch agent' }));
    await user.type(screen.getByLabelText('Agent name'), 'reviewer');
    await user.type(screen.getByLabelText('Agent arguments'), '--full-auto --model gpt-5');
    await user.clear(screen.getByLabelText('Startup timeout in seconds'));
    await user.type(screen.getByLabelText('Startup timeout in seconds'), '45');
    await user.click(screen.getByRole('button', { name: 'Start agent' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'start-agent',
      paneId: 'w1:p1',
      name: 'reviewer',
      kind: 'codex',
      args: ['--full-auto', '--model', 'gpt-5'],
      timeoutMs: 45_000,
    });
  });

  it('opens complete pane controls and routes graphical actions to Herdr', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Pane actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'More pane controls' }));

    expect(screen.getByRole('heading', { name: 'Pane controls and details' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pane details' })).toHaveTextContent(
      '/code/herdr-desktop',
    );
    await user.click(screen.getByRole('button', { name: 'Focus pane left' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'focus-pane-direction',
      paneId: 'w1:p1',
      direction: 'left',
    });
  });

  it('loads and manages public Herdr plugins through the plugin center', async () => {
    let desktopAction: ((action: DesktopAction) => void) | undefined;
    window.herdr.onDesktopAction = vi.fn((listener) => {
      desktopAction = listener;
      return () => undefined;
    });
    window.herdr.query = vi.fn(async (query) => {
      if (query.type === 'list-plugin-actions') {
        return {
          type: 'plugin-action-list' as const,
          actions: [
            {
              plugin_id: 'example.review',
              action_id: 'review',
              title: 'Review selection',
              contexts: ['pane' as const],
              command: ['review'],
            },
          ],
        };
      }
      return {
        type: 'plugin-list' as const,
        plugins: [
          {
            plugin_id: 'example.review',
            name: 'Review tools',
            version: '1.0.0',
            min_herdr_version: '0.8.0',
            description: 'Review the focused pane.',
            manifest_path: '/plugins/review/herdr-plugin.toml',
            plugin_root: '/plugins/review',
            enabled: true,
            build: [],
            startup: [],
            actions: [],
            events: [],
            panes: [
              {
                id: 'dashboard',
                title: 'Review dashboard',
                placement: 'overlay' as const,
                command: ['review-dashboard'],
              },
            ],
            link_handlers: [],
            source: { kind: 'local' as const },
            warnings: [],
          },
        ],
      };
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'herdr-desktop' });

    act(() => desktopAction?.('open-plugins'));
    expect(await screen.findByRole('heading', { name: 'Installed plugins' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Review selection' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Disable Review tools' }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'disable-plugin',
      pluginId: 'example.review',
    });

    await user.click(screen.getByRole('button', { name: 'Open Review tools pane' }));
    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'open-plugin-pane',
      pluginId: 'example.review',
      entrypoint: 'dashboard',
      placement: 'overlay',
      focus: true,
    });

    const placement = screen.getByRole('combobox', {
      name: 'Review tools pane placement',
    });
    await user.selectOptions(placement, 'split');
    await user.click(screen.getByRole('button', { name: 'Open Review tools pane' }));
    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'open-plugin-pane',
      pluginId: 'example.review',
      entrypoint: 'dashboard',
      placement: 'split',
      targetPaneId: 'w1:p1',
      direction: 'right',
      focus: true,
    });

    await user.selectOptions(placement, 'tab');
    await user.click(screen.getByRole('button', { name: 'Open Review tools pane' }));
    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'open-plugin-pane',
      pluginId: 'example.review',
      entrypoint: 'dashboard',
      placement: 'tab',
      workspaceId: 'w1',
      focus: true,
    });

    await user.selectOptions(placement, 'zoomed');
    await user.click(screen.getByRole('button', { name: 'Open Review tools pane' }));
    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'open-plugin-pane',
      pluginId: 'example.review',
      entrypoint: 'dashboard',
      placement: 'zoomed',
      targetPaneId: 'w1:p1',
      focus: true,
    });
  });

  it('keeps loaded plugin content visible while refreshing the dialog', async () => {
    let desktopAction: ((action: DesktopAction) => void) | undefined;
    let refreshing = false;
    let resolvePluginRefresh: ((value: HerdrQueryResult) => void) | undefined;
    let resolveActionRefresh: ((value: HerdrQueryResult) => void) | undefined;
    window.herdr.onDesktopAction = vi.fn((listener) => {
      desktopAction = listener;
      return () => undefined;
    });
    window.herdr.query = vi.fn((query) => {
      if (!refreshing) {
        return Promise.resolve(
          query.type === 'list-plugin-actions'
            ? { type: 'plugin-action-list' as const, actions: [] }
            : {
                type: 'plugin-list' as const,
                plugins: [
                  {
                    plugin_id: 'example.review',
                    name: 'Review tools',
                    version: '1.0.0',
                    min_herdr_version: '0.8.0',
                    manifest_path: '/plugins/review/herdr-plugin.toml',
                    plugin_root: '/plugins/review',
                    enabled: true,
                    build: [],
                    startup: [],
                    actions: [],
                    events: [],
                    panes: [],
                    link_handlers: [],
                    source: { kind: 'local' as const },
                    warnings: [],
                  },
                ],
              },
        );
      }
      if (query.type === 'list-plugin-actions') {
        return new Promise<HerdrQueryResult>((resolve) => {
          resolveActionRefresh = resolve;
        });
      }
      return new Promise<HerdrQueryResult>((resolve) => {
        resolvePluginRefresh = resolve;
      });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'herdr-desktop' });

    act(() => desktopAction?.('open-plugins'));
    expect(await screen.findByRole('heading', { name: 'Review tools' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveClass('overflow-hidden');
    expect(
      screen
        .getByRole('heading', { name: 'Review tools' })
        .closest('[data-slot="plugin-scroll-region"]'),
    ).toHaveClass('overflow-y-auto');

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Herdr plugins' })).not.toBeInTheDocument(),
    );
    refreshing = true;
    act(() => desktopAction?.('open-plugins'));
    await waitFor(() => expect(window.herdr.query).toHaveBeenCalledTimes(4));

    expect(screen.getByRole('heading', { name: 'Review tools' })).toBeInTheDocument();
    expect(screen.queryByText('Loading installed plugins…')).not.toBeInTheDocument();

    resolvePluginRefresh?.({ type: 'plugin-list', plugins: [] });
    resolveActionRefresh?.({ type: 'plugin-action-list', actions: [] });
  });

  it('opens Herdr’s native plugin installer in a new terminal tab', async () => {
    let desktopAction: ((action: DesktopAction) => void) | undefined;
    window.herdr.onDesktopAction = vi.fn((listener) => {
      desktopAction = listener;
      return () => undefined;
    });
    window.herdr.query = vi.fn(async (query) =>
      query.type === 'list-plugin-actions'
        ? { type: 'plugin-action-list' as const, actions: [] }
        : { type: 'plugin-list' as const, plugins: [] },
    );
    const installSnapshot: SessionSnapshot = {
      ...snapshot,
      focused_tab_id: 'w1:t2',
      focused_pane_id: 'w1:p2',
      tabs: [
        ...snapshot.tabs,
        {
          tab_id: 'w1:t2',
          workspace_id: 'w1',
          number: 2,
          label: 'plugin install',
          focused: true,
          pane_count: 1,
          agent_status: 'idle',
        },
      ],
      panes: [
        ...snapshot.panes,
        {
          pane_id: 'w1:p2',
          terminal_id: 'terminal-install',
          workspace_id: 'w1',
          tab_id: 'w1:t2',
          focused: true,
          cwd: '/code/herdr-desktop',
          label: 'plugin install',
          agent_status: 'idle',
          state_labels: {},
          tokens: {},
          revision: 1,
        },
      ],
    };
    const installed = { ...connected, snapshot: installSnapshot } satisfies EngineBootstrap;
    window.herdr.command = vi.fn(async () => installed);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'herdr-desktop' });

    act(() => desktopAction?.('open-plugins'));
    await user.type(
      await screen.findByRole('textbox', { name: 'GitHub plugin source' }),
      'smarzban/herdr-file-viewer',
    );
    await user.type(screen.getByRole('textbox', { name: 'Git ref' }), "release'candidate");
    await user.click(screen.getByRole('button', { name: 'Install with Herdr' }));

    await waitFor(() =>
      expect(window.herdr.command).toHaveBeenNthCalledWith(1, {
        type: 'create-tab',
        workspaceId: 'w1',
        label: 'plugin install',
      }),
    );
    expect(window.herdr.command).toHaveBeenNthCalledWith(2, {
      type: 'send-pane-input',
      paneId: 'w1:p2',
      text: "'/usr/local/bin/herdr' plugin install 'smarzban/herdr-file-viewer' --ref 'release'\\''candidate'",
      keys: ['enter'],
    });
    expect(screen.queryByRole('heading', { name: 'Herdr plugins' })).not.toBeInTheDocument();
  });

  it('exposes the canonical session switcher for compact layouts', async () => {
    const user = userEvent.setup();
    render(<App />);

    const switcherButton = await screen.findByRole('button', { name: 'Open session switcher' });
    expect(switcherButton).toHaveClass('xl:hidden');
    expect(screen.getByText('spaces').closest('aside')).toHaveClass('xl:flex');
    expect(screen.getByText('agents').closest('aside')).toHaveClass('xl:flex');

    await user.click(switcherButton);
    expect(screen.getByRole('region', { name: 'Mobile session switcher' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Agents, 1 total/i })).toBeInTheDocument();
  });

  it('shows the active engine binary and can choose a new one without terminal setup', async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: 'herdr-desktop' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('/usr/local/bin/herdr')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose Herdr binary' }));
    expect(window.herdr.chooseHerdrBinary).toHaveBeenCalledOnce();
  });

  it('opens settings and refreshes the Herdr snapshot with desktop shortcuts', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'herdr-desktop' });

    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    vi.mocked(window.herdr.bootstrap).mockClear();
    fireEvent.keyDown(window, { key: 'r', metaKey: true });
    await waitFor(() => expect(window.herdr.bootstrap).toHaveBeenCalledOnce());
  });

  it('handles native application menu actions through the secure preload bridge', async () => {
    let desktopAction: ((action: DesktopAction) => void) | undefined;
    window.herdr.onDesktopAction = vi.fn((listener) => {
      desktopAction = listener;
      return () => undefined;
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'herdr-desktop' });

    act(() => desktopAction?.('open-settings'));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });

    vi.mocked(window.herdr.bootstrap).mockClear();
    act(() => desktopAction?.('refresh'));
    await waitFor(() => expect(window.herdr.bootstrap).toHaveBeenCalledOnce());
  });

  it('focuses workspaces and active agent panes with desktop navigation controls', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'herdr-desktop' });

    fireEvent.keyDown(window, { key: '2', metaKey: true });
    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'focus-workspace',
      workspaceId: 'w2',
    });

    await user.click(screen.getByRole('button', { name: 'Focus builder' }));
    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'focus-pane',
      paneId: 'w1:p1',
    });
  });

  it('keeps the connected workspace visible when a command fails', async () => {
    window.herdr.command = vi.fn(
      async (): Promise<EngineBootstrap> => ({
        state: 'error',
        message: 'Herdr command failed.',
        details: 'pane is not available',
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Split pane right' }));

    expect(await screen.findByText('pane is not available')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'herdr-desktop' })).toBeInTheDocument();
  });

  it('shows the desktop version below the engine version in the sidebar footer', async () => {
    render(<App />);

    await screen.findByRole('heading', { name: 'herdr-desktop' });
    const footer = screen.getByText(/Desktop v/).parentElement;

    expect(footer).toHaveTextContent('v0.8.0 · protocol 7');
    expect(footer).toHaveTextContent(`Desktop v${packageMetadata.version}`);
  });

  it('updates the Herdr engine from the sidebar footer', async () => {
    window.herdr.engineUpdate = vi.fn(async () => ({
      bootstrap: connected,
      updated: true,
      version: '0.9.0',
      message: 'Herdr engine updated to v0.9.0.',
    }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Update Herdr engine' }));

    expect(window.herdr.engineUpdate).toHaveBeenCalledOnce();
    expect(await screen.findByText('Herdr engine updated to v0.9.0.')).toBeInTheDocument();
  });

  it('offers the latest release page when a desktop update is available', async () => {
    window.herdr.checkDesktopUpdate = vi.fn(async () => ({
      currentVersion: '0.1.7',
      latestVersion: '0.1.8',
      updateAvailable: true,
      releaseUrl: 'https://github.com/marcelormendes/herdr-desktop/releases/latest',
    }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Update Herdr Desktop' }));
    expect(window.herdr.checkDesktopUpdate).toHaveBeenCalledOnce();

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Herdr Desktop update available');
    expect(dialog).toHaveTextContent('v0.1.7 → v0.1.8');

    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(window.herdr.openExternal).toHaveBeenCalledWith(
      'https://github.com/marcelormendes/herdr-desktop/releases/latest',
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('reports when the desktop is already up to date', async () => {
    window.herdr.checkDesktopUpdate = vi.fn(async () => ({
      currentVersion: packageMetadata.version,
      latestVersion: packageMetadata.version,
      updateAvailable: false,
      releaseUrl: 'https://github.com/marcelormendes/herdr-desktop/releases/latest',
    }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Update Herdr Desktop' }));

    expect(
      await screen.findByText(`Herdr Desktop is up to date (v${packageMetadata.version}).`),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('surfaces an engine update failure from the sidebar footer', async () => {
    window.herdr.engineUpdate = vi.fn(async () => ({
      bootstrap: connected,
      updated: false,
      version: '0.8.0',
      message: 'self-update is disabled for Homebrew installs; run `brew upgrade herdr`',
      error: 'self-update is disabled for Homebrew installs; run `brew upgrade herdr`',
    }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Update Herdr engine' }));

    expect(
      await screen.findByText(
        'self-update is disabled for Homebrew installs; run `brew upgrade herdr`',
      ),
    ).toBeInTheDocument();
  });

  it('shows a useful installation path when the Herdr binary is unavailable', async () => {
    window.herdr.bootstrap = vi.fn(
      async (): Promise<EngineBootstrap> => ({
        state: 'missing',
        message: 'Herdr was not found. Install Herdr or choose its binary in Settings.',
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Open install guide' }));

    expect(screen.getByRole('heading', { name: 'Herdr engine not found' })).toBeInTheDocument();
    expect(window.herdr.openExternal).toHaveBeenCalledWith(
      'https://github.com/herdrdev/herdr#installation',
    );
  });

  it('keeps the update actions available when the engine is not connected', async () => {
    window.herdr.bootstrap = vi.fn(
      async (): Promise<EngineBootstrap> => ({
        state: 'missing',
        message: 'Herdr was not found. Install Herdr or choose its binary in Settings.',
      }),
    );
    window.herdr.checkDesktopUpdate = vi.fn(async () => ({
      currentVersion: '0.1.7',
      latestVersion: '0.1.8',
      updateAvailable: true,
      releaseUrl: 'https://github.com/marcelormendes/herdr-desktop/releases/latest',
    }));
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: 'Herdr engine not found' });
    expect(screen.getByRole('button', { name: 'Update Herdr engine' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Herdr Desktop' })).toBeInTheDocument();
    expect(screen.getByText(`Desktop v${packageMetadata.version}`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Update Herdr Desktop' }));
    expect(window.herdr.checkDesktopUpdate).toHaveBeenCalledOnce();

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Herdr Desktop update available');
  });

  it('can start a stopped Herdr server from the onboarding screen', async () => {
    window.herdr.bootstrap = vi.fn(
      async (): Promise<EngineBootstrap> => ({
        state: 'stopped',
        status: connected.status,
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Start Herdr' }));

    expect(window.herdr.startServer).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'herdr-desktop' })).toBeInTheDocument();
  });

  it('renders canonical snapshot agents instead of reconstructing them from panes', async () => {
    render(<App />);

    const card = await screen.findByTestId('agent-card-w1:p1');
    expect(card).toHaveTextContent('builder');
    expect(card).toHaveTextContent('Ready');
    expect(card).toHaveTextContent('implementing');
  });

  it('opens the searchable Navigator from native actions and focuses canonical results', async () => {
    const user = userEvent.setup();
    let desktopAction: ((action: DesktopAction) => void) | undefined;
    window.herdr.onDesktopAction = vi.fn((listener) => {
      desktopAction = listener;
      return () => undefined;
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'herdr-desktop' });

    act(() => desktopAction?.('open-navigator'));
    expect(screen.getByRole('heading', { name: 'Session navigator' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search session'), 'Notes');
    await user.click(screen.getByRole('option', { name: /^Notes \/code\/release-notes/i }));

    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'focus-pane',
      paneId: 'w2:p1',
    });
  });

  it('translates terminal page scrolling to Herdr canonical scroll commands', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Terminal view' }));
    await user.click(await screen.findByRole('button', { name: 'Test canonical scroll' }));
    expect(window.herdr.terminal.scroll).toHaveBeenCalledWith({
      paneId: 'w1:p1',
      direction: 'up',
      lines: 24,
      source: 'page_key',
    });
  });

  it('uses the complete desktop settings surface and persists presentation preferences', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'herdr-desktop' });

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Play notification sounds' }));

    expect(window.herdr.writePreferences).toHaveBeenCalledWith({
      ...DEFAULT_DESKTOP_PREFERENCES,
      sound: false,
    });
  });

  it('routes native directional pane actions through the finite Herdr command contract', async () => {
    let desktopAction: ((action: DesktopAction) => void) | undefined;
    window.herdr.onDesktopAction = vi.fn((listener) => {
      desktopAction = listener;
      return () => undefined;
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'herdr-desktop' });

    act(() => desktopAction?.('focus-pane-left'));
    expect(window.herdr.command).toHaveBeenCalledWith({
      type: 'focus-pane-direction',
      paneId: 'w1:p1',
      direction: 'left',
    });
  });

  it('surfaces event-stream reconnect state without losing the canonical session', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    window.herdr.onSessionEvent = vi.fn((listener) => {
      sessionEvent = listener;
      return () => undefined;
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'herdr-desktop' });

    act(() =>
      sessionEvent?.({ event: 'desktop.connection_state', data: { state: 'reconnecting' } }),
    );

    expect(screen.getByText('Engine reconnecting')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'herdr-desktop' })).toBeInTheDocument();
  });

  it('coalesces background refreshes while session events stream', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    window.herdr.onSessionEvent = vi.fn((listener) => {
      sessionEvent = listener;
      return () => undefined;
    });
    vi.useFakeTimers();
    try {
      render(<App />);
      await act(async () => {});
      await act(async () => {});
      expect(screen.getByRole('heading', { name: 'herdr-desktop' })).toBeInTheDocument();
      const initial = vi.mocked(window.herdr.bootstrap).mock.calls.length;

      // A burst of events must not re-bootstrap per event: nothing runs while
      // the stream is still settling.
      act(() => {
        sessionEvent?.({ event: 'layout.updated', data: {} });
        sessionEvent?.({ event: 'pane.focused', data: {} });
        sessionEvent?.({ event: 'tab.focused', data: {} });
      });
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(vi.mocked(window.herdr.bootstrap).mock.calls.length).toBe(initial);

      // Once the stream settles, exactly one quiet refresh runs.
      act(() => {
        vi.advanceTimersByTime(900);
      });
      await act(async () => {});
      expect(vi.mocked(window.herdr.bootstrap).mock.calls.length).toBe(initial + 1);

      // A second burst settles the trailing timer anew and refreshes 400ms
      // after the last event of that burst.
      act(() => {
        sessionEvent?.({ event: 'layout.updated', data: {} });
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      await act(async () => {});
      expect(vi.mocked(window.herdr.bootstrap).mock.calls.length).toBe(initial + 2);

      // With the stream quiet, no further refresh happens on its own.
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      await act(async () => {});
      expect(vi.mocked(window.herdr.bootstrap).mock.calls.length).toBe(initial + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never runs overlapping background refreshes', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    window.herdr.onSessionEvent = vi.fn((listener) => {
      sessionEvent = listener;
      return () => undefined;
    });
    const resolvers: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(window.herdr.bootstrap).mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          resolvers.push(() => {
            inFlight -= 1;
            resolve(connected);
          });
        }),
    );
    vi.useFakeTimers();
    try {
      render(<App />);
      await act(async () => {
        resolvers.shift()?.();
      });
      expect(screen.getByRole('heading', { name: 'herdr-desktop' })).toBeInTheDocument();
      const initial = vi.mocked(window.herdr.bootstrap).mock.calls.length;

      // Start a background refresh and keep events flowing while it hangs.
      act(() => {
        sessionEvent?.({ event: 'layout.updated', data: {} });
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(vi.mocked(window.herdr.bootstrap).mock.calls.length).toBe(initial + 1);
      act(() => {
        sessionEvent?.({ event: 'pane.focused', data: {} });
        sessionEvent?.({ event: 'tab.focused', data: {} });
      });
      // Even after the settle window passes, no second bootstrap may start
      // while the first is still in flight.
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(vi.mocked(window.herdr.bootstrap).mock.calls.length).toBe(initial + 1);
      expect(maxInFlight).toBe(1);

      // Completing the in-flight refresh drains the queued events exactly once.
      await act(async () => {
        resolvers.shift()?.();
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      await act(async () => {});
      expect(vi.mocked(window.herdr.bootstrap).mock.calls.length).toBe(initial + 2);
      expect(maxInFlight).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes during a nonstop event stream without overlapping bootstraps', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    window.herdr.onSessionEvent = vi.fn((listener) => {
      sessionEvent = listener;
      return () => undefined;
    });
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'herdr-desktop' });
    const initialCalls = vi.mocked(window.herdr.bootstrap).mock.calls.length;
    let resolveRefresh: ((value: EngineBootstrap) => void) | undefined;
    vi.mocked(window.herdr.bootstrap)
      .mockImplementationOnce(
        () =>
          new Promise<EngineBootstrap>((resolve) => {
            resolveRefresh = resolve;
          }),
      )
      .mockResolvedValue(connected);
    vi.useFakeTimers();

    const streamEvents = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        act(() => {
          sessionEvent?.({ event: 'pane_focused', data: { pane_id: 'w1:p1' } });
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });
      }
    };

    try {
      await streamEvents(12);
      expect(window.herdr.bootstrap).toHaveBeenCalledTimes(initialCalls + 1);

      await streamEvents(12);
      expect(window.herdr.bootstrap).toHaveBeenCalledTimes(initialCalls + 1);

      await act(async () => {
        resolveRefresh?.(connected);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(window.herdr.bootstrap).toHaveBeenCalledTimes(initialCalls + 2);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('does not let a stale bootstrap completion clobber newer stream state', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    window.herdr.onSessionEvent = vi.fn((listener) => {
      sessionEvent = listener;
      return () => undefined;
    });
    const resolvers: Array<() => void> = [];
    vi.mocked(window.herdr.bootstrap).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve(connected));
        }),
    );
    vi.useFakeTimers();
    try {
      render(<App />);
      await act(async () => {
        resolvers.shift()?.();
      });
      expect(screen.getByRole('heading', { name: 'herdr-desktop' })).toBeInTheDocument();

      // A background refresh starts, then the stream reports reconnecting
      // while that refresh is still in flight.
      act(() => {
        sessionEvent?.({ event: 'layout.updated', data: {} });
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      act(() => {
        sessionEvent?.({ event: 'desktop.connection_state', data: { state: 'reconnecting' } });
      });
      expect(screen.getByText('Engine reconnecting')).toBeInTheDocument();

      // The stale bootstrap completion must not flip the pill back.
      await act(async () => {
        resolvers.shift()?.();
      });
      expect(screen.getByText('Engine reconnecting')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no orphan refreshes after unmounting mid-refresh', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    window.herdr.onSessionEvent = vi.fn((listener) => {
      sessionEvent = listener;
      return () => undefined;
    });
    const resolvers: Array<() => void> = [];
    vi.mocked(window.herdr.bootstrap).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve(connected));
        }),
    );
    vi.useFakeTimers();
    try {
      const { unmount } = render(<App />);
      await act(async () => {
        resolvers.shift()?.();
      });
      expect(screen.getByRole('heading', { name: 'herdr-desktop' })).toBeInTheDocument();
      const initial = vi.mocked(window.herdr.bootstrap).mock.calls.length;

      // A refresh starts, events keep coming, and the component unmounts
      // while the bootstrap is still hanging.
      act(() => {
        sessionEvent?.({ event: 'layout.updated', data: {} });
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(vi.mocked(window.herdr.bootstrap).mock.calls.length).toBe(initial + 1);
      unmount();
      await act(async () => {
        resolvers.shift()?.();
      });
      // No trailing refresh may be scheduled after unmount.
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(vi.mocked(window.herdr.bootstrap).mock.calls.length).toBe(initial + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes once when the stream resynchronizes', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    window.herdr.onSessionEvent = vi.fn((listener) => {
      sessionEvent = listener;
      return () => undefined;
    });
    vi.useFakeTimers();
    try {
      render(<App />);
      await act(async () => {});
      await act(async () => {});
      expect(screen.getByRole('heading', { name: 'herdr-desktop' })).toBeInTheDocument();
      const initial = vi.mocked(window.herdr.bootstrap).mock.calls.length;

      act(() => {
        sessionEvent?.({ event: 'desktop.resynchronized', data: {} });
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      await act(async () => {});
      expect(vi.mocked(window.herdr.bootstrap).mock.calls.length).toBe(initial + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds refresh rate under a continuous event flood', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    window.herdr.onSessionEvent = vi.fn((listener) => {
      sessionEvent = listener;
      return () => undefined;
    });
    vi.useFakeTimers();
    try {
      render(<App />);
      await act(async () => {});
      await act(async () => {});
      expect(screen.getByRole('heading', { name: 'herdr-desktop' })).toBeInTheDocument();
      const initial = vi.mocked(window.herdr.bootstrap).mock.calls.length;

      // Events never stop: the trailing settle timer keeps resetting, and the
      // refresh may fire at most once per freshness window (1s).
      for (let step = 0; step < 26; step += 1) {
        act(() => {
          sessionEvent?.({ event: 'layout.updated', data: {} });
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200);
        });
      }
      expect(vi.mocked(window.herdr.bootstrap).mock.calls.length).toBe(initial + 5);
    } finally {
      vi.useRealTimers();
    }
  });
});
