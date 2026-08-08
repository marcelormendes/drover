import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { HerdrApiClient } from '@/main/herdr/api-client';
import { decodeHerdrQueryResult } from '@/main/herdr/query-decoder';
import { decodeSessionSnapshot } from '@/main/herdr/snapshot-decoder';
import type {
  EngineUpdateResult,
  HerdrCommand,
  HerdrQuery,
  HerdrQueryResult,
  PaneMoveDestination,
  PluginInvocationContext,
} from '@/shared/desktop-api';
import type { EngineBootstrap, HerdrStatus, SessionSnapshot } from '@/shared/herdr';

const execFileAsync = promisify(execFile);

/**
 * `herdr update` downloads the new binary (up to 120s), verifies its
 * checksum, and may live-hand off running servers (up to 240s), so the
 * desktop gives it a generous timeout instead of the 15s CLI default.
 */
const ENGINE_UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

export interface HerdrCommandResult {
  stdout: string;
  stderr: string;
}

export interface HerdrCommandRunner {
  run(args: string[], options?: { timeoutMs?: number }): Promise<HerdrCommandResult>;
}

export interface HerdrServerLauncher {
  launch(): Promise<void>;
}

export interface HerdrRequestClient {
  request(socketPath: string, method: string, params: unknown): Promise<unknown>;
}

export class NodeHerdrCommandRunner implements HerdrCommandRunner {
  constructor(private readonly binary = process.env.HERDR_DESKTOP_BIN || 'herdr') {}

  async run(args: string[], options?: { timeoutMs?: number }): Promise<HerdrCommandResult> {
    const { stdout, stderr } = await execFileAsync(this.binary, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: options?.timeoutMs ?? 15_000,
      windowsHide: true,
    });

    return { stdout, stderr };
  }
}

export class NodeHerdrServerLauncher implements HerdrServerLauncher {
  constructor(private readonly binary = process.env.HERDR_DESKTOP_BIN || 'herdr') {}

  launch(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, ['server'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });

      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }
}

class InvalidHerdrResponse extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(stdout: string, responseName: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new InvalidHerdrResponse(`Herdr returned an invalid ${responseName} response.`);
  }
}

function parseStatus(stdout: string): HerdrStatus {
  const value = parseJson(stdout, 'status');
  if (
    !isRecord(value) ||
    !isRecord(value.client) ||
    !isRecord(value.server) ||
    typeof value.server.running !== 'boolean' ||
    typeof value.client.version !== 'string'
  ) {
    throw new InvalidHerdrResponse('Herdr returned an invalid status response.');
  }

  return value as unknown as HerdrStatus;
}

function parseSnapshot(stdout: string): SessionSnapshot {
  const value = parseJson(stdout, 'session snapshot');
  if (!isRecord(value) || !isRecord(value.result) || !isRecord(value.result.snapshot)) {
    throw new InvalidHerdrResponse('Herdr returned an invalid session snapshot response.');
  }

  const snapshot = value.result.snapshot;
  const decoded = decodeSessionSnapshot(snapshot);
  if (value.result.type !== 'session_snapshot' || decoded === null) {
    throw new InvalidHerdrResponse('Herdr returned an invalid session snapshot response.');
  }

  return decoded;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function errorDetails(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function commandRequest(command: HerdrCommand): {
  method: string;
  params: Record<string, unknown>;
} {
  switch (command.type) {
    case 'focus-workspace':
      return { method: 'workspace.focus', params: { workspace_id: command.workspaceId } };
    case 'focus-tab':
      return { method: 'tab.focus', params: { tab_id: command.tabId } };
    case 'focus-pane':
      return { method: 'pane.focus', params: { pane_id: command.paneId } };
    case 'create-workspace':
      return {
        method: 'workspace.create',
        params: {
          ...(command.cwd ? { cwd: command.cwd } : {}),
          ...(command.label ? { label: command.label } : {}),
          focus: true,
          env: {},
        },
      };
    case 'create-tab':
      return {
        method: 'tab.create',
        params: {
          workspace_id: command.workspaceId,
          ...(command.cwd ? { cwd: command.cwd } : {}),
          ...(command.label ? { label: command.label } : {}),
          focus: true,
          env: {},
        },
      };
    case 'split-pane':
      return {
        method: 'pane.split',
        params: {
          target_pane_id: command.paneId,
          direction: command.direction,
          focus: true,
          env: {},
        },
      };
    case 'rename-workspace':
      return {
        method: 'workspace.rename',
        params: { workspace_id: command.workspaceId, label: command.label },
      };
    case 'close-workspace':
      return { method: 'workspace.close', params: { workspace_id: command.workspaceId } };
    case 'rename-tab':
      return { method: 'tab.rename', params: { tab_id: command.tabId, label: command.label } };
    case 'close-tab':
      return { method: 'tab.close', params: { tab_id: command.tabId } };
    case 'rename-pane':
      return {
        method: 'pane.rename',
        params: { pane_id: command.paneId, label: command.label },
      };
    case 'close-pane':
      return { method: 'pane.close', params: { pane_id: command.paneId } };
    case 'zoom-pane':
      return {
        method: 'pane.zoom',
        params: { pane_id: command.paneId, mode: command.mode || 'toggle' },
      };
    case 'start-agent':
      return {
        method: 'agent.start',
        params: {
          pane_id: command.paneId,
          name: command.name,
          kind: command.kind,
          args: command.args || [],
          timeout_ms: command.timeoutMs || 30_000,
        },
      };
    case 'move-workspace':
      return {
        method: 'workspace.move',
        params: { workspace_id: command.workspaceId, insert_index: command.insertIndex },
      };
    case 'move-workspace-block':
      return {
        method: 'workspace.move_block',
        params: {
          workspace_ids: command.workspaceIds,
          ...(command.beforeWorkspaceId === undefined
            ? {}
            : { before_workspace_id: command.beforeWorkspaceId }),
        },
      };
    case 'create-worktree':
      return {
        method: 'worktree.create',
        params: {
          ...(command.workspaceId === undefined ? {} : { workspace_id: command.workspaceId }),
          ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
          ...(command.branch === undefined ? {} : { branch: command.branch }),
          ...(command.base === undefined ? {} : { base: command.base }),
          ...(command.path === undefined ? {} : { path: command.path }),
          ...(command.label === undefined ? {} : { label: command.label }),
          ...(command.focus === undefined ? {} : { focus: command.focus }),
        },
      };
    case 'open-worktree':
      return {
        method: 'worktree.open',
        params: {
          ...(command.workspaceId === undefined ? {} : { workspace_id: command.workspaceId }),
          ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
          ...(command.branch === undefined ? {} : { branch: command.branch }),
          ...(command.path === undefined ? {} : { path: command.path }),
          ...(command.label === undefined ? {} : { label: command.label }),
          ...(command.focus === undefined ? {} : { focus: command.focus }),
        },
      };
    case 'remove-worktree':
      return {
        method: 'worktree.remove',
        params: {
          workspace_id: command.workspaceId,
          ...(command.force === undefined ? {} : { force: command.force }),
        },
      };
    case 'move-tab':
      return {
        method: 'tab.move',
        params: { tab_id: command.tabId, insert_index: command.insertIndex },
      };
    case 'swap-pane':
      return 'paneId' in command
        ? {
            method: 'pane.swap',
            params: { pane_id: command.paneId, direction: command.direction },
          }
        : {
            method: 'pane.swap',
            params: {
              source_pane_id: command.sourcePaneId,
              target_pane_id: command.targetPaneId,
            },
          };
    case 'move-pane':
      return {
        method: 'pane.move',
        params: {
          pane_id: command.paneId,
          destination: paneMoveDestination(command.destination),
          ...(command.focus === undefined ? {} : { focus: command.focus }),
        },
      };
    case 'focus-pane-direction':
      return {
        method: 'pane.focus_direction',
        params: { pane_id: command.paneId, direction: command.direction },
      };
    case 'resize-pane':
      return {
        method: 'pane.resize',
        params: {
          pane_id: command.paneId,
          direction: command.direction,
          ...(command.amount === undefined ? {} : { amount: command.amount }),
        },
      };
    case 'set-split-ratio':
      return {
        method: 'layout.set_split_ratio',
        params: {
          ...(command.tabId === undefined ? {} : { tab_id: command.tabId }),
          ...(command.paneId === undefined ? {} : { pane_id: command.paneId }),
          path: command.path,
          ratio: command.ratio,
        },
      };
    case 'rename-agent':
      return {
        method: 'agent.rename',
        params: {
          target: command.target,
          ...(command.name === undefined ? {} : { name: command.name }),
        },
      };
    case 'send-pane-input':
      return {
        method: 'pane.send_input',
        params: {
          pane_id: command.paneId,
          ...(command.text === undefined ? {} : { text: command.text }),
          ...(command.keys === undefined ? {} : { keys: command.keys }),
        },
      };
    case 'prompt-agent':
      return {
        method: 'agent.prompt',
        params: {
          target: command.target,
          text: command.text,
          ...(command.wait === undefined
            ? {}
            : {
                wait: {
                  until: command.wait.until,
                  ...(command.wait.timeoutMs === undefined
                    ? {}
                    : { timeout_ms: command.wait.timeoutMs }),
                },
              }),
        },
      };
    case 'set-agent-view':
      return {
        method: 'agent.view.set',
        params: {
          source: command.source,
          ...(command.label === undefined ? {} : { label: command.label }),
          ...(command.filter === undefined ? {} : { filter: command.filter }),
          ...(command.sort === undefined ? {} : { sort: command.sort }),
        },
      };
    case 'clear-agent-view':
      return {
        method: 'agent.view.clear',
        params: command.source === undefined ? {} : { source: command.source },
      };
    case 'install-integration':
      return { method: 'integration.install', params: { target: command.target } };
    case 'uninstall-integration':
      return { method: 'integration.uninstall', params: { target: command.target } };
    case 'reload-server-config':
      return { method: 'server.reload_config', params: {} };
    case 'stop-server':
      return { method: 'server.stop', params: {} };
    case 'live-handoff-server':
      return {
        method: 'server.live_handoff',
        params: {
          ...(command.importExe === undefined ? {} : { import_exe: command.importExe }),
          ...(command.expectedProtocol === undefined
            ? {}
            : { expected_protocol: command.expectedProtocol }),
          ...(command.expectedVersion === undefined
            ? {}
            : { expected_version: command.expectedVersion }),
        },
      };
    case 'reload-agent-manifests':
      return { method: 'server.reload_agent_manifests', params: {} };
    case 'invoke-plugin-action':
      return {
        method: 'plugin.action.invoke',
        params: {
          action_id: command.actionId,
          ...(command.pluginId === undefined ? {} : { plugin_id: command.pluginId }),
          ...(command.context === undefined
            ? {}
            : { context: pluginInvocationContext(command.context) }),
        },
      };
    case 'open-plugin-pane':
      return {
        method: 'plugin.pane.open',
        params: {
          plugin_id: command.pluginId,
          entrypoint: command.entrypoint,
          ...(command.placement === undefined ? {} : { placement: command.placement }),
          ...(command.workspaceId === undefined ? {} : { workspace_id: command.workspaceId }),
          ...(command.targetPaneId === undefined ? {} : { target_pane_id: command.targetPaneId }),
          ...(command.direction === undefined ? {} : { direction: command.direction }),
          ...(command.width === undefined ? {} : { width: command.width }),
          ...(command.height === undefined ? {} : { height: command.height }),
          ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
          ...(command.focus === undefined ? {} : { focus: command.focus }),
          ...(command.env === undefined ? {} : { env: command.env }),
        },
      };
    case 'focus-plugin-pane':
      return { method: 'plugin.pane.focus', params: { pane_id: command.paneId } };
    case 'close-plugin-pane':
      return { method: 'plugin.pane.close', params: { pane_id: command.paneId } };
    case 'enable-plugin':
      return { method: 'plugin.enable', params: { plugin_id: command.pluginId } };
    case 'disable-plugin':
      return { method: 'plugin.disable', params: { plugin_id: command.pluginId } };
  }
}

function pluginInvocationContext(context: PluginInvocationContext): Record<string, unknown> {
  return {
    ...(context.workspaceId === undefined ? {} : { workspace_id: context.workspaceId }),
    ...(context.workspaceLabel === undefined ? {} : { workspace_label: context.workspaceLabel }),
    ...(context.workspaceCwd === undefined ? {} : { workspace_cwd: context.workspaceCwd }),
    ...(context.worktree === undefined
      ? {}
      : {
          worktree: {
            repo_key: context.worktree.repoKey,
            repo_name: context.worktree.repoName,
            repo_root: context.worktree.repoRoot,
            checkout_path: context.worktree.checkoutPath,
            is_linked_worktree: context.worktree.isLinkedWorktree,
          },
        }),
    ...(context.tabId === undefined ? {} : { tab_id: context.tabId }),
    ...(context.tabLabel === undefined ? {} : { tab_label: context.tabLabel }),
    ...(context.focusedPaneId === undefined ? {} : { focused_pane_id: context.focusedPaneId }),
    ...(context.focusedPaneCwd === undefined ? {} : { focused_pane_cwd: context.focusedPaneCwd }),
    ...(context.focusedPaneAgent === undefined
      ? {}
      : { focused_pane_agent: context.focusedPaneAgent }),
    ...(context.focusedPaneStatus === undefined
      ? {}
      : { focused_pane_status: context.focusedPaneStatus }),
    ...(context.selectedText === undefined ? {} : { selected_text: context.selectedText }),
    ...(context.invocationSource === undefined
      ? {}
      : { invocation_source: context.invocationSource }),
    ...(context.correlationId === undefined ? {} : { correlation_id: context.correlationId }),
    ...(context.clickedUrl === undefined ? {} : { clicked_url: context.clickedUrl }),
    ...(context.linkHandlerId === undefined ? {} : { link_handler_id: context.linkHandlerId }),
  };
}

function paneMoveDestination(destination: PaneMoveDestination): Record<string, unknown> {
  switch (destination.type) {
    case 'tab':
      return {
        type: 'tab',
        tab_id: destination.tabId,
        ...(destination.targetPaneId === undefined
          ? {}
          : { target_pane_id: destination.targetPaneId }),
        split: destination.split,
        ...(destination.ratio === undefined ? {} : { ratio: destination.ratio }),
      };
    case 'new-tab':
      return {
        type: 'new_tab',
        ...(destination.workspaceId === undefined ? {} : { workspace_id: destination.workspaceId }),
        ...(destination.label === undefined ? {} : { label: destination.label }),
      };
    case 'new-workspace':
      return {
        type: 'new_workspace',
        ...(destination.label === undefined ? {} : { label: destination.label }),
        ...(destination.tabLabel === undefined ? {} : { tab_label: destination.tabLabel }),
      };
  }
}

function queryRequest(query: HerdrQuery): {
  method: string;
  params: Record<string, unknown>;
} {
  switch (query.type) {
    case 'read-pane-output':
      // The server's 'text' format always strips ANSI (strip_ansi is only
      // honored in 'ansi' format). The chat surface needs the CLI's own
      // colors to tell thinking from answer, so request the raw stream and
      // strip locally.
      return {
        method: 'pane.read',
        params: {
          pane_id: query.paneId,
          source: 'recent_unwrapped',
          format: query.ansi ? 'ansi' : 'text',
          strip_ansi: !query.ansi,
          ...(query.lines === undefined ? {} : { lines: query.lines }),
        },
      };
    case 'list-worktrees':
      return {
        method: 'worktree.list',
        params: {
          ...(query.workspaceId === undefined ? {} : { workspace_id: query.workspaceId }),
          ...(query.cwd === undefined ? {} : { cwd: query.cwd }),
        },
      };
    case 'get-agent-manifests':
      return { method: 'server.agent_manifests', params: {} };
    case 'list-plugins':
      return {
        method: 'plugin.list',
        params: query.pluginId === undefined ? {} : { plugin_id: query.pluginId },
      };
    case 'list-plugin-actions':
      return {
        method: 'plugin.action.list',
        params: query.pluginId === undefined ? {} : { plugin_id: query.pluginId },
      };
  }
}

export class HerdrEngine {
  constructor(
    private readonly runner: HerdrCommandRunner = new NodeHerdrCommandRunner(),
    private readonly launcher: HerdrServerLauncher = new NodeHerdrServerLauncher(),
    private readonly wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly requestClient: HerdrRequestClient = new HerdrApiClient(),
  ) {}

  async bootstrap(): Promise<EngineBootstrap> {
    try {
      const status = parseStatus((await this.runner.run(['status', '--json'])).stdout);

      if (!status.server.running) {
        return { state: 'stopped', status };
      }

      if (status.server.compatible === false) {
        return { state: 'incompatible', status };
      }

      const snapshot = parseSnapshot((await this.runner.run(['api', 'snapshot'])).stdout);
      return { state: 'connected', status, snapshot };
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return {
          state: 'missing',
          message: 'Herdr was not found. Install Herdr or choose its binary in Settings.',
        };
      }

      if (error instanceof InvalidHerdrResponse) {
        return { state: 'error', message: error.message };
      }

      return {
        state: 'error',
        message: 'Herdr could not be reached.',
        details: errorDetails(error),
      };
    }
  }

  async startServer(): Promise<EngineBootstrap> {
    try {
      await this.launcher.launch();

      for (let attempt = 0; attempt < 40; attempt += 1) {
        await this.wait(250);
        const result = await this.bootstrap();
        if (result.state !== 'stopped') {
          return result;
        }
      }

      return {
        state: 'error',
        message: 'Herdr did not become ready in time.',
      };
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return {
          state: 'missing',
          message: 'Herdr was not found. Install Herdr or choose its binary in Settings.',
        };
      }

      return {
        state: 'error',
        message: 'Herdr could not be started.',
        details: errorDetails(error),
      };
    }
  }

  async execute(command: HerdrCommand): Promise<EngineBootstrap> {
    try {
      const status = parseStatus((await this.runner.run(['status', '--json'])).stdout);
      if (!status.server.running) {
        return { state: 'stopped', status };
      }
      if (status.server.compatible === false) {
        return { state: 'incompatible', status };
      }

      const request = commandRequest(command);
      await this.requestClient.request(status.server.socket, request.method, request.params);
      return this.bootstrap();
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return {
          state: 'missing',
          message: 'Herdr was not found. Install Herdr or choose its binary in Settings.',
        };
      }
      return {
        state: 'error',
        message: 'Herdr command failed.',
        details: errorDetails(error),
      };
    }
  }

  async query(query: HerdrQuery): Promise<HerdrQueryResult> {
    const status = parseStatus((await this.runner.run(['status', '--json'])).stdout);
    if (!status.server.running) {
      throw new Error('Herdr server is not running.');
    }
    if (status.server.compatible === false) {
      throw new Error('Herdr server protocol is incompatible.');
    }
    const request = queryRequest(query);
    const result = await this.requestClient.request(
      status.server.socket,
      request.method,
      request.params,
    );
    return decodeHerdrQueryResult(query, result);
  }

  private async readVersion(): Promise<string | null> {
    try {
      return parseStatus((await this.runner.run(['status', '--json'])).stdout).client.version;
    } catch {
      return null;
    }
  }

  /**
   * Runs the engine self-update (`herdr update --handoff`). Live handoff is
   * opted in so running servers restart onto the new binary without prompts;
   * when a server is too old for handoff, the engine reports the failure and
   * nothing is installed. Always returns an `EngineUpdateResult` instead of
   * throwing, with a human-readable message for the renderer.
   */
  async update(): Promise<EngineUpdateResult> {
    const before = await this.readVersion();

    try {
      const { stderr } = await this.runner.run(['update', '--handoff'], {
        timeoutMs: ENGINE_UPDATE_TIMEOUT_MS,
      });
      const status = parseStatus((await this.runner.run(['status', '--json'])).stdout);
      const after = status.client.version;
      const bootstrap = await this.bootstrap();

      const installed = after !== null && before !== null && after !== before;
      if (installed) {
        // The binary can be replaced while the running server stays on the
        // old version (for example when live handoff failed); only claim a
        // complete update when the server actually runs the new version.
        if (status.server.version === null || status.server.version === after) {
          return {
            bootstrap,
            updated: true,
            version: after,
            message: `Herdr engine updated to v${after}.`,
          };
        }
        return {
          bootstrap,
          updated: true,
          version: after,
          message: `Herdr engine updated to v${after}; the running server is still v${status.server.version} and needs a restart.`,
        };
      }

      if (stderr.includes('already up to date')) {
        return {
          bootstrap,
          updated: false,
          version: after ?? before,
          message: `Herdr engine is already up to date (v${after ?? before ?? 'unknown'}).`,
        };
      }

      return {
        bootstrap,
        updated: false,
        version: after ?? before,
        message: 'Herdr engine update completed without a version change.',
      };
    } catch (error) {
      const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr.trim() : '';
      const message =
        stderr || (error instanceof Error ? error.message : 'Herdr engine update failed.');
      const bootstrap = await this.bootstrap().catch((): EngineBootstrap => {
        return {
          state: 'error',
          message: 'Herdr could not be reached after the update attempt.',
          details: errorDetails(error),
        };
      });
      return { bootstrap, updated: false, version: before, message, error: message };
    }
  }
}
