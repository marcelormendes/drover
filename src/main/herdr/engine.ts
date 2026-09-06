import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { hostInvocation, sandboxPathFromHostPath } from '@/main/flatpak';
import { HerdrApiClient } from '@/main/herdr/api-client';
import {
  decodeAttachmentBeginResult,
  decodeAttachmentFinishedResult,
  decodeConversationReadResult,
  decodeConversationRespondResult,
} from '@/main/herdr/conversation-decoder';
import {
  defaultEngineInstallPath,
  hasPinnedEngineRelease,
  installPinnedEngineBinary,
  PINNED_ENGINE,
  pinnedEngineAsset,
} from '@/main/herdr/fork-engine';
import { decodeHerdrQueryResult } from '@/main/herdr/query-decoder';
import { decodeSessionSnapshot } from '@/main/herdr/snapshot-decoder';
import type {
  ConversationAttachmentAbortRequest,
  ConversationAttachmentBeginRequest,
  ConversationAttachmentBeginResult,
  ConversationAttachmentChunkRequest,
  ConversationAttachmentFinishRequest,
  ConversationPromptRequest,
  ConversationReadRequest,
  ConversationReadResult,
  ConversationRespondRequest,
  ConversationRespondResult,
  ConversationStagedAttachment,
} from '@/shared/conversation';
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
  /** The resolved engine binary path, or a bare command name like `herdr`. */
  readonly binary: string;
}

export interface HerdrServerLauncher {
  launch(): Promise<void>;
}

export interface HerdrRequestClient {
  request(socketPath: string, method: string, params: unknown): Promise<unknown>;
}

export class NodeHerdrCommandRunner implements HerdrCommandRunner {
  constructor(readonly binary = process.env.DROVER_BIN || 'herdr') {}

  async run(args: string[], options?: { timeoutMs?: number }): Promise<HerdrCommandResult> {
    const { program, args: bridgedArgs } = hostInvocation(this.binary, args);
    const { stdout, stderr } = await execFileAsync(program, bridgedArgs, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: options?.timeoutMs ?? 15_000,
      windowsHide: true,
    });

    return { stdout, stderr };
  }
}

export class NodeHerdrServerLauncher implements HerdrServerLauncher {
  constructor(private readonly binary = process.env.DROVER_BIN || 'herdr') {}

  launch(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { program, args: bridgedArgs } = hostInvocation(this.binary, ['server'], {
        // The server is intentionally detached and must outlive this app
        // process, so it is not tied to the session bus lifetime.
        watchBus: false,
      });
      const child = spawn(program, bridgedArgs, {
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

  // Inside the Flatpak, `herdr status` runs on the host and reports
  // host-visible socket paths; every sandbox-direct API/event connection
  // needs the equivalent sandbox path, so centralize the translation here.
  if (typeof value.server.socket === 'string') {
    value.server.socket = sandboxPathFromHostPath(value.server.socket);
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
          // A config override keeps Codex from reusing an unrelated local
          // app-server whose hook environment lacks this pane's Herdr identity.
          // Keep user overrides last so explicit launch preferences still win.
          args:
            command.kind === 'codex'
              ? ['-c', 'features.hooks=true', ...(command.args || [])]
              : command.args || [],
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

function queryRequest(query: Exclude<HerdrQuery, { type: 'get-integration-status' }>): {
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
          source: query.source ?? 'recent_unwrapped',
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
    /**
     * Invoked after the pinned engine lands on a path different from the
     * runner's current binary, so the app can switch to the new binary.
     */
    private readonly onBinaryInstalled?: (binaryPath: string) => void,
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
    if (query.type === 'get-integration-status') {
      // This CLI inspects local integration files and does not require a server.
      // The main-process IPC handler must reject it when using a remote engine.
      const { stdout } = await this.runner.run(['integration', 'status']);
      return decodeHerdrQueryResult(query, stdout);
    }
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

  private async conversationSocket(): Promise<string> {
    const status = parseStatus((await this.runner.run(['status', '--json'])).stdout);
    if (!status.server.running) {
      throw new Error('Herdr server is not running.');
    }
    if (status.server.compatible === false) {
      throw new Error('Herdr server protocol is incompatible.');
    }
    return status.server.socket;
  }

  async conversationRead(request: ConversationReadRequest): Promise<ConversationReadResult> {
    const socket = await this.conversationSocket();
    const result = await this.requestClient.request(socket, 'agent.conversation.read', {
      target: request.target,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      direction: request.direction ?? 'newest',
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });
    return decodeConversationReadResult(result);
  }
  async conversationMetadata(request: ConversationReadRequest): Promise<ConversationReadResult> {
    const socket = await this.conversationSocket();
    const result = await this.requestClient.request(socket, 'agent.conversation.metadata', {
      target: request.target,
    });
    return decodeConversationReadResult(result);
  }

  async conversationPrompt(request: ConversationPromptRequest): Promise<EngineBootstrap> {
    const socket = await this.conversationSocket();
    await this.requestClient.request(socket, 'agent.prompt', {
      target: request.target,
      text: request.text,
      ...(request.attachments === undefined || request.attachments.length === 0
        ? {}
        : { attachments: request.attachments.map(({ handle }) => ({ handle })) }),
    });
    return this.bootstrap();
  }

  async conversationRespond(
    request: ConversationRespondRequest,
  ): Promise<ConversationRespondResult> {
    const socket = await this.conversationSocket();
    const result = await this.requestClient.request(socket, 'agent.conversation.respond', {
      target: request.target,
      reader_generation: request.reader_generation,
      session: request.session,
      request_id: request.request_id,
      decision_id: request.decision_id,
    });
    return decodeConversationRespondResult(result);
  }

  async conversationAttachmentBegin(
    request: ConversationAttachmentBeginRequest,
  ): Promise<ConversationAttachmentBeginResult> {
    const socket = await this.conversationSocket();
    const result = await this.requestClient.request(socket, 'agent.attachment.begin', {
      target: request.target,
      media_type: request.media_type,
      name: request.name,
      byte_size: request.byte_size,
      sha256_digest: request.sha256_digest,
    });
    return decodeAttachmentBeginResult(result);
  }

  async conversationAttachmentChunk(request: ConversationAttachmentChunkRequest): Promise<void> {
    const socket = await this.conversationSocket();
    await this.requestClient.request(socket, 'agent.attachment.chunk', {
      upload: { handle: request.upload },
      index: request.index,
      data_base64: request.data_base64,
    });
  }

  async conversationAttachmentFinish(
    request: ConversationAttachmentFinishRequest,
  ): Promise<ConversationStagedAttachment> {
    const socket = await this.conversationSocket();
    const result = await this.requestClient.request(socket, 'agent.attachment.finish', {
      upload: { handle: request.upload },
    });
    return decodeAttachmentFinishedResult(result);
  }

  async conversationAttachmentAbort(request: ConversationAttachmentAbortRequest): Promise<void> {
    const socket = await this.conversationSocket();
    await this.requestClient.request(socket, 'agent.attachment.abort', {
      upload: { handle: request.upload },
    });
  }

  private async readVersion(): Promise<string | null> {
    try {
      return parseStatus((await this.runner.run(['status', '--json'])).stdout).client.version;
    } catch {
      return null;
    }
  }

  /**
   * Ensures the pinned fork build is used when structured Chat is unavailable
   * or the running/client engine is not the exact pinned release. `herdr update`
   * cannot be used here: it always downloads the stock upstream binary, which
   * lacks the capability. The pinned build is
   * downloaded from the fork release, checksum-verified, installed in place
   * of the resolved engine binary, and the running server is live-handed
   * onto it. Always returns an `EngineUpdateResult` instead of throwing,
   * with a human-readable message for the renderer.
   */
  async update(): Promise<EngineUpdateResult> {
    let before: string | null = null;
    let status: HerdrStatus | null = null;
    try {
      status = parseStatus((await this.runner.run(['status', '--json'])).stdout);
      before = status.client.version;
    } catch {
      // The engine may be missing or unstartable; the install below fixes that.
    }
    const bootstrap = await this.bootstrap();
    const pinnedChatAvailable =
      status?.client.version === PINNED_ENGINE.version &&
      status.server.version === PINNED_ENGINE.version &&
      status.server.capabilities?.agent_conversations === true;
    if (pinnedChatAvailable) {
      return {
        bootstrap,
        updated: false,
        version: before,
        message: `Herdr engine already provides structured Chat (v${before ?? 'unknown'}).`,
      };
    }

    const asset = pinnedEngineAsset(process.platform, process.arch);
    if (!asset) {
      const supported = hasPinnedEngineRelease(process.platform, process.arch);
      const message = supported
        ? 'The pinned engine release is not published yet; update Drover to install it.'
        : `No pinned Herdr engine release for ${process.platform}-${process.arch}; install the official Herdr engine instead.`;
      return { bootstrap, updated: false, version: before, message, error: message };
    }

    const resolvedBinary = this.runner.binary;
    const installTo = resolvedBinary.includes('/') ? resolvedBinary : defaultEngineInstallPath();

    try {
      await installPinnedEngineBinary({ asset, installTo });
      if (installTo !== resolvedBinary) {
        this.onBinaryInstalled?.(installTo);
      }

      const after = (await this.readVersion()) ?? PINNED_ENGINE.version;
      if (status?.server.running) {
        // The old server still runs from its previous inode; the new binary
        // requests the takeover so live panes move over without a restart.
        await this.runner.run(['server', 'live-handoff', '--import-exe', installTo], {
          timeoutMs: ENGINE_UPDATE_TIMEOUT_MS,
        });
      }
      // The pinned build ships newer integration assets; without a reinstall
      // the agent extensions stay on the old protocol version and their
      // session reports (and structured Chat) are rejected by the new server.
      const integrationsReinstalled = await this.reinstallInstalledIntegrations();
      const fresh = await this.bootstrap().catch((): EngineBootstrap => {
        return {
          state: 'error',
          message: 'Herdr could not be reached after the engine update.',
          details: `installed ${PINNED_ENGINE.version} at ${installTo}`,
        };
      });
      return {
        bootstrap: fresh,
        updated: true,
        version: after,
        message: integrationsReinstalled
          ? `Herdr engine updated to v${after} with structured Chat. Restart your agent sessions to enable it.`
          : `Herdr engine updated to v${after} with structured Chat.`,
      };
    } catch (error) {
      const stderr = isRecord(error) && typeof error.stderr === 'string' ? error.stderr.trim() : '';
      const message =
        stderr || (error instanceof Error ? error.message : 'Herdr engine update failed.');
      const fresh = await this.bootstrap().catch((): EngineBootstrap => {
        return {
          state: 'error',
          message: 'Herdr could not be reached after the update attempt.',
          details: errorDetails(error),
        };
      });
      return { bootstrap: fresh, updated: false, version: before, message, error: message };
    }
  }

  /**
   * Best-effort refresh of the agent integration extensions after the engine
   * binary changed: every installed provider gets its extension rewritten
   * from the new binary's bundled assets. Returns true when at least one
   * provider was reinstalled.
   */
  private async reinstallInstalledIntegrations(): Promise<boolean> {
    let installedTargets: string[] = [];
    try {
      const { stdout } = await this.runner.run(['integration', 'status']);
      installedTargets = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.includes('not installed'))
        .map((line) => line.split(':')[0]?.trim())
        .filter((target): target is string => Boolean(target));
    } catch {
      return false;
    }
    if (installedTargets.length === 0) {
      return false;
    }
    let reinstalled = false;
    for (const target of installedTargets) {
      try {
        await this.runner.run(['integration', 'install', target]);
        reinstalled = true;
      } catch {
        // A failed extension rewrite must not fail the engine update; the
        // agent session simply keeps the previous extension until restarted.
      }
    }
    return reinstalled;
  }
}
