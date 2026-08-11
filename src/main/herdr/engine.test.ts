import { afterEach, describe, expect, it, vi } from 'vitest';

import { FLATPAK_APP_ID } from '@/main/flatpak';
import {
  type HerdrCommandRunner,
  HerdrEngine,
  type HerdrRequestClient,
  type HerdrServerLauncher,
} from '@/main/herdr/engine';
import {
  defaultEngineInstallPath,
  hasPinnedEngineRelease,
  installPinnedEngineBinary,
  pinnedEngineAsset,
} from '@/main/herdr/fork-engine';
import type { HerdrCommand } from '@/shared/desktop-api';

vi.mock('@/main/herdr/fork-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/main/herdr/fork-engine')>();
  return {
    ...actual,
    pinnedEngineAsset: vi.fn((platform: NodeJS.Platform, arch: string) =>
      actual.pinnedEngineAsset(platform, arch),
    ),
    hasPinnedEngineRelease: vi.fn((platform: NodeJS.Platform, arch: string) =>
      actual.hasPinnedEngineRelease(platform, arch),
    ),
    installPinnedEngineBinary: vi.fn(
      (options: Parameters<typeof actual.installPinnedEngineBinary>[0]) =>
        actual.installPinnedEngineBinary(options),
    ),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const runningStatus = {
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
};

const snapshot = {
  version: '0.8.0',
  protocol: 7,
  focused_workspace_id: 'w1',
  focused_tab_id: 'w1:t1',
  focused_pane_id: 'w1:p1',
  workspaces: [
    {
      workspace_id: 'w1',
      number: 1,
      label: 'herdr',
      focused: true,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: 'w1:t1',
      agent_status: 'working',
      tokens: {},
    },
  ],
  tabs: [
    {
      tab_id: 'w1:t1',
      workspace_id: 'w1',
      number: 1,
      label: 'main',
      focused: true,
      pane_count: 1,
      agent_status: 'working',
    },
  ],
  panes: [
    {
      pane_id: 'w1:p1',
      terminal_id: 'terminal-1',
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      focused: true,
      cwd: '/code/herdr',
      label: 'Implementation',
      agent: 'codex',
      agent_status: 'working',
      state_labels: {},
      tokens: {},
      revision: 4,
    },
  ],
  layouts: [],
  agents: [],
};

function createRunner(
  implementation: HerdrCommandRunner['run'],
  binary = '/usr/local/bin/herdr',
): HerdrCommandRunner & { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn(implementation), binary };
}

describe('HerdrEngine.bootstrap', () => {
  it('returns the engine status and canonical session snapshot when connected', async () => {
    const runner = createRunner(async (args) => {
      if (args[0] === 'status') {
        return { stdout: JSON.stringify(runningStatus), stderr: '' };
      }

      return {
        stdout: JSON.stringify({
          id: 'cli:api:snapshot',
          result: { type: 'session_snapshot', snapshot },
        }),
        stderr: '',
      };
    });

    const result = await new HerdrEngine(runner).bootstrap();

    expect(result).toEqual({ state: 'connected', status: runningStatus, snapshot });
    expect(runner.run).toHaveBeenNthCalledWith(1, ['status', '--json']);
    expect(runner.run).toHaveBeenNthCalledWith(2, ['api', 'snapshot']);
  });

  it('returns stopped without requesting a snapshot when the server is not running', async () => {
    const status = {
      ...runningStatus,
      server: {
        ...runningStatus.server,
        status: 'not running',
        running: false,
        version: null,
        protocol: null,
        capabilities: null,
        compatible: null,
      },
    };
    const runner = createRunner(async () => ({ stdout: JSON.stringify(status), stderr: '' }));

    const result = await new HerdrEngine(runner).bootstrap();

    expect(result).toEqual({ state: 'stopped', status });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an unavailable Herdr binary from a broken server', async () => {
    const error = Object.assign(new Error('spawn herdr ENOENT'), { code: 'ENOENT' });
    const runner = createRunner(async () => {
      throw error;
    });

    await expect(new HerdrEngine(runner).bootstrap()).resolves.toEqual({
      state: 'missing',
      message: 'Herdr was not found. Install Herdr or choose its binary in Settings.',
    });
  });

  it('surfaces protocol incompatibility without reading a snapshot', async () => {
    const status = {
      ...runningStatus,
      server: { ...runningStatus.server, compatible: false, protocol: 6 },
    };
    const runner = createRunner(async () => ({ stdout: JSON.stringify(status), stderr: '' }));

    const result = await new HerdrEngine(runner).bootstrap();

    expect(result).toEqual({ state: 'incompatible', status });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('returns a diagnostic error for malformed engine output', async () => {
    const runner = createRunner(async () => ({ stdout: 'not-json', stderr: '' }));

    const result = await new HerdrEngine(runner).bootstrap();

    expect(result.state).toBe('error');
    expect(result).toMatchObject({ message: 'Herdr returned an invalid status response.' });
  });
});

describe('HerdrEngine.startServer', () => {
  it('launches the headless Herdr server and waits for its canonical snapshot', async () => {
    let statusRequests = 0;
    const runner = createRunner(async (args) => {
      if (args[0] === 'status') {
        statusRequests += 1;
        const server =
          statusRequests === 1
            ? {
                ...runningStatus.server,
                status: 'not running',
                running: false,
                version: null,
                protocol: null,
                compatible: null,
              }
            : runningStatus.server;
        return { stdout: JSON.stringify({ ...runningStatus, server }), stderr: '' };
      }

      return {
        stdout: JSON.stringify({
          id: 'cli:api:snapshot',
          result: { type: 'session_snapshot', snapshot },
        }),
        stderr: '',
      };
    });
    const launcher: HerdrServerLauncher = { launch: vi.fn(async () => undefined) };
    const wait = vi.fn(async () => undefined);

    const result = await new HerdrEngine(runner, launcher, wait).startServer();

    expect(launcher.launch).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledTimes(2);
    expect(result.state).toBe('connected');
  });
});

describe('HerdrEngine.execute', () => {
  it.each<{
    command: HerdrCommand;
    method: string;
    params: Record<string, unknown>;
  }>([
    {
      command: { type: 'focus-workspace', workspaceId: 'w2' },
      method: 'workspace.focus',
      params: { workspace_id: 'w2' },
    },
    {
      command: { type: 'focus-tab', tabId: 'w1:t2' },
      method: 'tab.focus',
      params: { tab_id: 'w1:t2' },
    },
    {
      command: { type: 'focus-pane', paneId: 'w1:p2' },
      method: 'pane.focus',
      params: { pane_id: 'w1:p2' },
    },
    {
      command: { type: 'create-workspace', cwd: '/code/new', label: 'new' },
      method: 'workspace.create',
      params: { cwd: '/code/new', label: 'new', focus: true, env: {} },
    },
    {
      command: { type: 'create-tab', workspaceId: 'w1', label: 'tests' },
      method: 'tab.create',
      params: { workspace_id: 'w1', label: 'tests', focus: true, env: {} },
    },
    {
      command: { type: 'split-pane', paneId: 'w1:p1', direction: 'right' },
      method: 'pane.split',
      params: { target_pane_id: 'w1:p1', direction: 'right', focus: true, env: {} },
    },
    {
      command: { type: 'rename-workspace', workspaceId: 'w1', label: 'Desktop' },
      method: 'workspace.rename',
      params: { workspace_id: 'w1', label: 'Desktop' },
    },
    {
      command: { type: 'close-workspace', workspaceId: 'w1' },
      method: 'workspace.close',
      params: { workspace_id: 'w1' },
    },
    {
      command: { type: 'rename-tab', tabId: 'w1:t1', label: 'Tests' },
      method: 'tab.rename',
      params: { tab_id: 'w1:t1', label: 'Tests' },
    },
    {
      command: { type: 'close-tab', tabId: 'w1:t1' },
      method: 'tab.close',
      params: { tab_id: 'w1:t1' },
    },
    {
      command: { type: 'rename-pane', paneId: 'w1:p1', label: 'Review' },
      method: 'pane.rename',
      params: { pane_id: 'w1:p1', label: 'Review' },
    },
    {
      command: { type: 'close-pane', paneId: 'w1:p1' },
      method: 'pane.close',
      params: { pane_id: 'w1:p1' },
    },
    {
      command: { type: 'zoom-pane', paneId: 'w1:p1', mode: 'toggle' },
      method: 'pane.zoom',
      params: { pane_id: 'w1:p1', mode: 'toggle' },
    },
    {
      command: { type: 'start-agent', paneId: 'w1:p1', name: 'reviewer', kind: 'codex' },
      method: 'agent.start',
      params: {
        pane_id: 'w1:p1',
        name: 'reviewer',
        kind: 'codex',
        args: [],
        timeout_ms: 30_000,
      },
    },
    {
      command: {
        type: 'start-agent',
        paneId: 'w1:p1',
        name: 'reviewer',
        kind: 'codex',
        args: ['--full-auto'],
        timeoutMs: 45_000,
      },
      method: 'agent.start',
      params: {
        pane_id: 'w1:p1',
        name: 'reviewer',
        kind: 'codex',
        args: ['--full-auto'],
        timeout_ms: 45_000,
      },
    },
    {
      command: { type: 'move-workspace', workspaceId: 'w2', insertIndex: 0 },
      method: 'workspace.move',
      params: { workspace_id: 'w2', insert_index: 0 },
    },
    {
      command: {
        type: 'move-workspace-block',
        workspaceIds: ['w2', 'w3'],
        beforeWorkspaceId: 'w1',
      },
      method: 'workspace.move_block',
      params: { workspace_ids: ['w2', 'w3'], before_workspace_id: 'w1' },
    },
    {
      command: {
        type: 'create-worktree',
        workspaceId: 'w1',
        cwd: '/code/herdr',
        branch: 'feature/desktop',
        base: 'main',
        path: '/worktrees/desktop',
        label: 'desktop',
        focus: true,
      },
      method: 'worktree.create',
      params: {
        workspace_id: 'w1',
        cwd: '/code/herdr',
        branch: 'feature/desktop',
        base: 'main',
        path: '/worktrees/desktop',
        label: 'desktop',
        focus: true,
      },
    },
    {
      command: {
        type: 'open-worktree',
        workspaceId: 'w1',
        cwd: '/code/herdr',
        branch: 'feature/desktop',
        label: 'desktop',
        focus: false,
      },
      method: 'worktree.open',
      params: {
        workspace_id: 'w1',
        cwd: '/code/herdr',
        branch: 'feature/desktop',
        label: 'desktop',
        focus: false,
      },
    },
    {
      command: { type: 'remove-worktree', workspaceId: 'w2', force: true },
      method: 'worktree.remove',
      params: { workspace_id: 'w2', force: true },
    },
    {
      command: { type: 'move-tab', tabId: 'w1:t2', insertIndex: 0 },
      method: 'tab.move',
      params: { tab_id: 'w1:t2', insert_index: 0 },
    },
    {
      command: { type: 'swap-pane', paneId: 'w1:p1', direction: 'left' },
      method: 'pane.swap',
      params: { pane_id: 'w1:p1', direction: 'left' },
    },
    {
      command: { type: 'swap-pane', sourcePaneId: 'w1:p1', targetPaneId: 'w1:p2' },
      method: 'pane.swap',
      params: { source_pane_id: 'w1:p1', target_pane_id: 'w1:p2' },
    },
    {
      command: {
        type: 'move-pane',
        paneId: 'w1:p2',
        destination: {
          type: 'tab',
          tabId: 'w2:t1',
          targetPaneId: 'w2:p1',
          split: 'right',
          ratio: 0.4,
        },
        focus: true,
      },
      method: 'pane.move',
      params: {
        pane_id: 'w1:p2',
        destination: {
          type: 'tab',
          tab_id: 'w2:t1',
          target_pane_id: 'w2:p1',
          split: 'right',
          ratio: 0.4,
        },
        focus: true,
      },
    },
    {
      command: { type: 'focus-pane-direction', paneId: 'w1:p1', direction: 'down' },
      method: 'pane.focus_direction',
      params: { pane_id: 'w1:p1', direction: 'down' },
    },
    {
      command: { type: 'resize-pane', paneId: 'w1:p1', direction: 'right', amount: 0.1 },
      method: 'pane.resize',
      params: { pane_id: 'w1:p1', direction: 'right', amount: 0.1 },
    },
    {
      command: { type: 'resize-pane', paneId: 'w1:p1', direction: 'right' },
      method: 'pane.resize',
      params: { pane_id: 'w1:p1', direction: 'right' },
    },
    {
      command: { type: 'set-split-ratio', tabId: 'w1:t1', path: [false, true], ratio: 0.6 },
      method: 'layout.set_split_ratio',
      params: { tab_id: 'w1:t1', path: [false, true], ratio: 0.6 },
    },
    {
      command: { type: 'rename-agent', target: 'reviewer', name: 'reviewer-2' },
      method: 'agent.rename',
      params: { target: 'reviewer', name: 'reviewer-2' },
    },
    {
      command: { type: 'rename-agent', target: 'reviewer' },
      method: 'agent.rename',
      params: { target: 'reviewer' },
    },
    {
      command: {
        type: 'prompt-agent',
        target: 'reviewer',
        text: 'Review this',
        wait: { until: ['done', 'blocked'], timeoutMs: 60_000 },
      },
      method: 'agent.prompt',
      params: {
        target: 'reviewer',
        text: 'Review this',
        wait: { until: ['done', 'blocked'], timeout_ms: 60_000 },
      },
    },
    {
      command: { type: 'send-pane-input', paneId: 'w1:p1', text: '/compact', keys: ['enter'] },
      method: 'pane.send_input',
      params: { pane_id: 'w1:p1', text: '/compact', keys: ['enter'] },
    },
    {
      command: {
        type: 'set-agent-view',
        source: 'desktop',
        label: 'Attention',
        filter: { op: 'eq', field: 'status', value: 'blocked' },
        sort: [{ field: 'attention', order: 'desc' }],
      },
      method: 'agent.view.set',
      params: {
        source: 'desktop',
        label: 'Attention',
        filter: { op: 'eq', field: 'status', value: 'blocked' },
        sort: [{ field: 'attention', order: 'desc' }],
      },
    },
    {
      command: { type: 'clear-agent-view', source: 'desktop' },
      method: 'agent.view.clear',
      params: { source: 'desktop' },
    },
    {
      command: { type: 'clear-agent-view' },
      method: 'agent.view.clear',
      params: {},
    },
    {
      command: { type: 'set-agent-view', source: 'desktop' },
      method: 'agent.view.set',
      params: { source: 'desktop' },
    },
    {
      command: { type: 'install-integration', target: 'codex' },
      method: 'integration.install',
      params: { target: 'codex' },
    },
    {
      command: { type: 'uninstall-integration', target: 'codex' },
      method: 'integration.uninstall',
      params: { target: 'codex' },
    },
    {
      command: { type: 'reload-server-config' },
      method: 'server.reload_config',
      params: {},
    },
    {
      command: { type: 'stop-server' },
      method: 'server.stop',
      params: {},
    },
    {
      command: { type: 'live-handoff-server' },
      method: 'server.live_handoff',
      params: {},
    },
    {
      command: {
        type: 'live-handoff-server',
        importExe: '/opt/herdr/herdr',
        expectedProtocol: 19,
        expectedVersion: '0.8.0',
      },
      method: 'server.live_handoff',
      params: {
        import_exe: '/opt/herdr/herdr',
        expected_protocol: 19,
        expected_version: '0.8.0',
      },
    },
    {
      command: { type: 'reload-agent-manifests' },
      method: 'server.reload_agent_manifests',
      params: {},
    },
    {
      command: {
        type: 'invoke-plugin-action',
        actionId: 'review',
        pluginId: 'example.review',
        context: {
          workspaceId: 'w1',
          selectedText: 'const answer = 42;',
          invocationSource: 'desktop',
        },
      },
      method: 'plugin.action.invoke',
      params: {
        action_id: 'review',
        plugin_id: 'example.review',
        context: {
          workspace_id: 'w1',
          selected_text: 'const answer = 42;',
          invocation_source: 'desktop',
        },
      },
    },
    {
      command: {
        type: 'open-plugin-pane',
        pluginId: 'example.review',
        entrypoint: 'dashboard',
        placement: 'split',
        workspaceId: 'w1',
        targetPaneId: 'w1:p1',
        direction: 'right',
        width: '80%',
        height: 30,
        cwd: '/code/herdr',
        focus: true,
        env: { REVIEW_MODE: 'strict' },
      },
      method: 'plugin.pane.open',
      params: {
        plugin_id: 'example.review',
        entrypoint: 'dashboard',
        placement: 'split',
        workspace_id: 'w1',
        target_pane_id: 'w1:p1',
        direction: 'right',
        width: '80%',
        height: 30,
        cwd: '/code/herdr',
        focus: true,
        env: { REVIEW_MODE: 'strict' },
      },
    },
    {
      command: { type: 'focus-plugin-pane', paneId: 'w1:p2' },
      method: 'plugin.pane.focus',
      params: { pane_id: 'w1:p2' },
    },
    {
      command: { type: 'close-plugin-pane', paneId: 'w1:p2' },
      method: 'plugin.pane.close',
      params: { pane_id: 'w1:p2' },
    },
    {
      command: { type: 'enable-plugin', pluginId: 'example.review' },
      method: 'plugin.enable',
      params: { plugin_id: 'example.review' },
    },
    {
      command: { type: 'disable-plugin', pluginId: 'example.review' },
      method: 'plugin.disable',
      params: { plugin_id: 'example.review' },
    },
  ])(
    'maps $command.type to the canonical $method API method',
    async ({ command, method, params }) => {
      const runner = createRunner(async (args) => {
        if (args[0] === 'status') {
          return { stdout: JSON.stringify(runningStatus), stderr: '' };
        }
        return {
          stdout: JSON.stringify({
            id: 'cli:api:snapshot',
            result: { type: 'session_snapshot', snapshot },
          }),
          stderr: '',
        };
      });
      const requestClient: HerdrRequestClient = {
        request: vi.fn(async () => ({ type: 'ok' })),
      };

      const result = await new HerdrEngine(
        runner,
        { launch: vi.fn() },
        async () => undefined,
        requestClient,
      ).execute(command);

      expect(requestClient.request).toHaveBeenCalledWith('/tmp/herdr.sock', method, params);
      expect(result.state).toBe('connected');
    },
  );

  it('translates host-form status sockets to sandbox paths before direct connections', async () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('HOST_XDG_CONFIG_HOME', '/host-config');
    vi.stubEnv('XDG_CONFIG_HOME', '/sandbox-config');
    const hostStatus = {
      ...runningStatus,
      server: { ...runningStatus.server, socket: '/host-config/herdr/herdr.sock' },
    };
    const runner = createRunner(async (args) => {
      if (args[0] === 'status') {
        return { stdout: JSON.stringify(hostStatus), stderr: '' };
      }
      return {
        stdout: JSON.stringify({
          id: 'cli:api:snapshot',
          result: { type: 'session_snapshot', snapshot },
        }),
        stderr: '',
      };
    });
    const requestClient: HerdrRequestClient = {
      request: vi.fn(async () => ({ type: 'ok' })),
    };

    const result = await new HerdrEngine(
      runner,
      { launch: vi.fn() },
      async () => undefined,
      requestClient,
    ).execute({ type: 'focus-workspace', workspaceId: 'w1' });

    expect(requestClient.request).toHaveBeenCalledWith(
      '/sandbox-config/herdr/herdr.sock',
      'workspace.focus',
      expect.any(Object),
    );
    expect(result.state).toBe('connected');
  });

  it('rejects a snapshot whose nested protocol fields are malformed', async () => {
    const malformedSnapshot = {
      ...snapshot,
      panes: [{ ...snapshot.panes[0], revision: 'four' }],
    };
    const runner = createRunner(async (args) => {
      if (args[0] === 'status') {
        return { stdout: JSON.stringify(runningStatus), stderr: '' };
      }
      return {
        stdout: JSON.stringify({
          id: 'cli:api:snapshot',
          result: { type: 'session_snapshot', snapshot: malformedSnapshot },
        }),
        stderr: '',
      };
    });

    const result = await new HerdrEngine(runner).bootstrap();

    expect(result).toEqual({
      state: 'error',
      message: 'Herdr returned an invalid session snapshot response.',
    });
  });
});

describe('HerdrEngine.query', () => {
  it.each([
    {
      query: { type: 'read-pane-output', paneId: 'w1:p1', lines: 500 } as const,
      method: 'pane.read',
      params: {
        pane_id: 'w1:p1',
        source: 'recent_unwrapped',
        format: 'text',
        strip_ansi: true,
        lines: 500,
      },
      wireResult: {
        type: 'pane_read',
        read: {
          pane_id: 'w1:p1',
          workspace_id: 'w1',
          tab_id: 'w1:t1',
          source: 'recent_unwrapped',
          format: 'text',
          text: 'Implemented the chat surface.',
          revision: 12,
          truncated: false,
        },
      },
      expectedType: 'pane-output',
    },
    {
      query: { type: 'read-pane-output', paneId: 'w1:p1', lines: 500, ansi: true } as const,
      method: 'pane.read',
      params: {
        pane_id: 'w1:p1',
        source: 'recent_unwrapped',
        // The engine exposes `format: 'ansi'` so the chat surface can see
        // the CLI's own colors: 'text' always strips, even with
        // strip_ansi: false (the server only honors the flag in 'ansi').
        format: 'ansi',
        strip_ansi: false,
        lines: 500,
      },
      wireResult: {
        type: 'pane_read',
        read: {
          pane_id: 'w1:p1',
          workspace_id: 'w1',
          tab_id: 'w1:t1',
          source: 'recent_unwrapped',
          format: 'ansi',
          text: 'Implemented the chat surface.',
          revision: 12,
          truncated: false,
        },
      },
      expectedType: 'pane-output',
    },
    {
      query: { type: 'list-worktrees', workspaceId: 'w1' } as const,
      method: 'worktree.list',
      params: { workspace_id: 'w1' },
      wireResult: {
        type: 'worktree_list',
        source: {
          repo_key: 'github.com/herdrdev/herdr',
          repo_name: 'herdr',
          repo_root: '/code/herdr',
          source_checkout_path: '/code/herdr',
          source_workspace_id: 'w1',
        },
        worktrees: [
          {
            path: '/code/herdr-worktrees/desktop',
            branch: 'feature/desktop',
            is_bare: false,
            is_detached: false,
            is_prunable: false,
            is_linked_worktree: true,
            open_workspace_id: 'w2',
            label: 'desktop',
          },
        ],
      },
      expectedType: 'worktree-list',
    },
    {
      query: { type: 'get-agent-manifests' } as const,
      method: 'server.agent_manifests',
      params: {},
      wireResult: {
        type: 'agent_manifest_status',
        last_check_unix: 123,
        last_result: 'current',
        manifests: [
          {
            agent: 'codex',
            source: '/tmp/codex.toml',
            source_kind: 'bundled',
            active_version: '3',
            cached_remote_version: '3',
            local_override_shadowing_remote: false,
          },
        ],
      },
      expectedType: 'agent-manifests',
    },
    {
      query: { type: 'list-plugins', pluginId: 'example.review' } as const,
      method: 'plugin.list',
      params: { plugin_id: 'example.review' },
      wireResult: {
        type: 'plugin_list',
        plugins: [
          {
            plugin_id: 'example.review',
            name: 'Review',
            version: '1.0.0',
            min_herdr_version: '0.8.0',
            manifest_path: '/plugins/review/herdr-plugin.toml',
            plugin_root: '/plugins/review',
            enabled: true,
            warnings: [],
          },
        ],
      },
      expectedType: 'plugin-list',
    },
    {
      query: { type: 'list-plugin-actions', pluginId: 'example.review' } as const,
      method: 'plugin.action.list',
      params: { plugin_id: 'example.review' },
      wireResult: {
        type: 'plugin_action_list',
        actions: [
          {
            plugin_id: 'example.review',
            action_id: 'review',
            title: 'Review changes',
            contexts: ['workspace'],
            command: ['review.sh'],
          },
        ],
      },
      expectedType: 'plugin-action-list',
    },
  ])(
    'maps and decodes $query.type',
    async ({ query, method, params, wireResult, expectedType }) => {
      const runner = createRunner(async () => ({
        stdout: JSON.stringify(runningStatus),
        stderr: '',
      }));
      const requestClient: HerdrRequestClient = {
        request: vi.fn(async () => wireResult),
      };
      const engine = new HerdrEngine(
        runner,
        { launch: vi.fn() },
        async () => undefined,
        requestClient,
      );

      const result = await engine.query(query);

      expect(requestClient.request).toHaveBeenCalledWith('/tmp/herdr.sock', method, params);
      expect(result.type).toBe(expectedType);
    },
  );

  it('rejects malformed feature query responses', async () => {
    const runner = createRunner(async () => ({
      stdout: JSON.stringify(runningStatus),
      stderr: '',
    }));
    const engine = new HerdrEngine(runner, { launch: vi.fn() }, async () => undefined, {
      request: vi.fn(async () => ({ type: 'plugin_list', plugins: [{ enabled: 'yes' }] })),
    });

    await expect(engine.query({ type: 'list-plugins' })).rejects.toThrow(
      'Herdr returned an invalid plugin list response.',
    );
  });
});

describe('HerdrEngine.update', () => {
  const chatStatus = {
    ...runningStatus,
    server: {
      ...runningStatus.server,
      capabilities: { ...runningStatus.server.capabilities, agent_conversations: true },
    },
  };

  const fakeAsset = {
    url: 'https://github.com/marcelormendes/herdr/releases/download/v0.8.1/herdr-linux-x86_64',
    sha256: 'f'.repeat(64),
  };

  const snapshotResponse = {
    stdout: JSON.stringify({
      id: 'cli:api:snapshot',
      result: { type: 'session_snapshot', snapshot },
    }),
    stderr: '',
  };

  afterEach(() => {
    vi.mocked(pinnedEngineAsset).mockRestore();
    vi.mocked(hasPinnedEngineRelease).mockRestore();
    vi.mocked(installPinnedEngineBinary).mockRestore();
  });

  it('reports structured Chat already available without touching the engine', async () => {
    const runner = createRunner(async (args) => {
      if (args[1] === 'snapshot') {
        return snapshotResponse;
      }
      return { stdout: JSON.stringify(chatStatus), stderr: '' };
    });

    const result = await new HerdrEngine(runner).update();

    expect(result).toEqual({
      bootstrap: { state: 'connected', status: chatStatus, snapshot },
      updated: false,
      version: '0.8.0',
      message: 'Herdr engine already provides structured Chat (v0.8.0).',
    });
    expect(installPinnedEngineBinary).not.toHaveBeenCalled();
  });

  it('installs the pinned engine and live-hands the running server onto it', async () => {
    vi.mocked(pinnedEngineAsset).mockReturnValue(fakeAsset);
    vi.mocked(installPinnedEngineBinary).mockResolvedValue(undefined);
    const updatedStatus = {
      ...runningStatus,
      client: { ...runningStatus.client, version: '0.8.1' },
      server: { ...runningStatus.server, version: '0.8.1' },
    };
    let statusCalls = 0;
    const runner = createRunner(async (args) => {
      if (args[0] === 'server' && args[1] === 'live-handoff') {
        return { stdout: '', stderr: 'live handoff complete' };
      }
      if (args[0] === 'integration' && args[1] === 'status') {
        return { stdout: 'pi: current (v11) (/x/herdr-agent-state.ts)\n', stderr: '' };
      }
      if (args[0] === 'integration' && args[1] === 'install') {
        return { stdout: '', stderr: '' };
      }
      if (args[1] === 'snapshot') {
        return snapshotResponse;
      }
      statusCalls += 1;
      return {
        stdout: JSON.stringify(statusCalls >= 3 ? updatedStatus : runningStatus),
        stderr: '',
      };
    });

    const result = await new HerdrEngine(runner).update();

    expect(installPinnedEngineBinary).toHaveBeenCalledWith({
      asset: fakeAsset,
      installTo: '/usr/local/bin/herdr',
    });
    expect(runner.run).toHaveBeenCalledWith(
      ['server', 'live-handoff', '--import-exe', '/usr/local/bin/herdr'],
      { timeoutMs: 10 * 60 * 1000 },
    );
    expect(runner.run).toHaveBeenCalledWith(['integration', 'install', 'pi']);
    expect(result).toMatchObject({
      updated: true,
      version: '0.8.1',
      message:
        'Herdr engine updated to v0.8.1 with structured Chat. Restart your agent sessions to enable it.',
    });
    expect(result.bootstrap.state).toBe('connected');
  });

  it('refuses to install while the pinned release checksum is unpublished', async () => {
    vi.mocked(pinnedEngineAsset).mockReturnValue({
      url: 'https://example.invalid/herdr',
      sha256: '',
    });
    const runner = createRunner(async (args) => {
      if (args[1] === 'snapshot') {
        return snapshotResponse;
      }
      return { stdout: JSON.stringify(runningStatus), stderr: '' };
    });

    const result = await new HerdrEngine(runner).update();

    expect(installPinnedEngineBinary).toHaveBeenCalled();
    expect(result).toMatchObject({
      updated: false,
      message:
        'The pinned engine release v0.8.1 is not published yet; update Herdr Desktop to install it.',
      error:
        'The pinned engine release v0.8.1 is not published yet; update Herdr Desktop to install it.',
    });
  });

  it('reports an honest error on platforms without a pinned release', async () => {
    vi.mocked(pinnedEngineAsset).mockReturnValue(null);
    vi.mocked(hasPinnedEngineRelease).mockReturnValue(false);
    const runner = createRunner(async (args) => {
      if (args[1] === 'snapshot') {
        return snapshotResponse;
      }
      return { stdout: JSON.stringify(runningStatus), stderr: '' };
    });

    const result = await new HerdrEngine(runner).update();

    expect(result).toMatchObject({
      updated: false,
      message:
        'No pinned Herdr engine release for linux-x64; install the official Herdr engine instead.',
    });
    expect(installPinnedEngineBinary).not.toHaveBeenCalled();
  });

  it('surfaces the engine error when the pinned install fails', async () => {
    vi.mocked(pinnedEngineAsset).mockReturnValue(fakeAsset);
    vi.mocked(installPinnedEngineBinary).mockRejectedValue(
      Object.assign(new Error('Command failed'), { stderr: 'download failed' }),
    );
    const runner = createRunner(async (args) => {
      if (args[1] === 'snapshot') {
        return snapshotResponse;
      }
      return { stdout: JSON.stringify(runningStatus), stderr: '' };
    });

    const result = await new HerdrEngine(runner).update();

    expect(result).toMatchObject({
      updated: false,
      version: '0.8.0',
      message: 'download failed',
      error: 'download failed',
    });
    expect(result.bootstrap.state).toBe('connected');
  });

  it('installs to the default location and reconfigures the app on first install', async () => {
    vi.mocked(pinnedEngineAsset).mockReturnValue(fakeAsset);
    vi.mocked(installPinnedEngineBinary).mockResolvedValue(undefined);
    const installed: string[] = [];
    const runner = createRunner(async (args) => {
      if (args[0] === 'integration' && args[1] === 'status') {
        return { stdout: 'omp: current (v13) (/x/herdr-omp-agent-state.ts)\n', stderr: '' };
      }
      if (args[0] === 'integration' && args[1] === 'install') {
        return { stdout: '', stderr: '' };
      }
      if (args[1] === 'snapshot') {
        return snapshotResponse;
      }
      return {
        stdout: JSON.stringify({
          ...runningStatus,
          server: { ...runningStatus.server, status: 'not_running', running: false },
        }),
        stderr: '',
      };
    }, 'herdr');

    const result = await new HerdrEngine(
      runner,
      { launch: vi.fn() },
      async () => undefined,
      { request: vi.fn() },
      (path) => installed.push(path),
    ).update();

    expect(installPinnedEngineBinary).toHaveBeenCalledWith({
      asset: fakeAsset,
      installTo: defaultEngineInstallPath(),
    });
    expect(installed).toEqual([defaultEngineInstallPath()]);
    expect(result.bootstrap.state).toBe('stopped');
  });

  it('keeps the previous status when the engine is unreachable after a failed update', async () => {
    vi.mocked(pinnedEngineAsset).mockReturnValue(fakeAsset);
    vi.mocked(installPinnedEngineBinary).mockRejectedValue(new Error('download failed'));
    const runner = createRunner(async () => {
      throw Object.assign(new Error('boom'), { code: 'ENOENT' });
    });

    const result = await new HerdrEngine(runner).update();

    expect(result.updated).toBe(false);
    expect(result.message).toBe('download failed');
    expect(result.bootstrap.state).toBe('missing');
  });
});
