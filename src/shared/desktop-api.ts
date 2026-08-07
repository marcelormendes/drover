import type { HerdrEventEnvelope } from '@/shared/events';
import type { EngineBootstrap } from '@/shared/herdr';
import type { DesktopPreferences } from '@/shared/preferences';
import type {
  TerminalEvent,
  TerminalInputRequest,
  TerminalOpenRequest,
  TerminalResizeRequest,
  TerminalScrollRequest,
} from '@/shared/terminal';

export const CHAT_IMAGE_EXTENSIONS = ['png', 'jpg', 'gif', 'webp', 'bmp'] as const;

export type ChatImageExtension = (typeof CHAT_IMAGE_EXTENSIONS)[number];

/** Mirrors Herdr's clipboard image payload limit for paste bridging. */
export const MAX_CHAT_IMAGE_BYTES = 16 * 1024 * 1024;

export const MAX_CHAT_IMAGE_BASE64_LENGTH = Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4;

/** Maximum images in a single chat submission. */
export const MAX_CHAT_IMAGE_ATTACHMENTS = 8;

/** Total decoded-byte budget for one chat submission. */
export const MAX_CHAT_IMAGE_TOTAL_BYTES = 32 * 1024 * 1024;

/** Canonical base64: whole four-character groups with correct trailing padding. */
export function isCanonicalBase64(data: string): boolean {
  if (data.length === 0 || data.length % 4 !== 0) {
    return false;
  }
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const body = data.length - padding;
  if (padding === 1 && data[body - 1] === '=') {
    return false;
  }
  for (let index = 0; index < body; index += 1) {
    const code = data.charCodeAt(index);
    const valid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47;
    if (!valid) {
      return false;
    }
  }
  // RFC 4648 requires unused pad bits to be zero.
  if (padding > 0) {
    const value = base64Value(data.charCodeAt(body - 1));
    if (padding === 2 ? (value & 0x0f) !== 0 : (value & 0x03) !== 0) {
      return false;
    }
  }
  return true;
}

/** Exact decoded length of a canonical base64 string. */
export function base64DecodedLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

function base64Value(code: number): number {
  if (code >= 65 && code <= 90) {
    return code - 65;
  }
  if (code >= 97 && code <= 122) {
    return code - 97 + 26;
  }
  if (code >= 48 && code <= 57) {
    return code - 48 + 52;
  }
  return code === 43 ? 62 : 63;
}

export interface ChatImageDraft {
  extension: string;
  /** Base64-encoded image bytes. */
  data: string;
}

export type HerdrCommand =
  | { type: 'focus-workspace'; workspaceId: string }
  | { type: 'focus-tab'; tabId: string }
  | { type: 'focus-pane'; paneId: string }
  | { type: 'create-workspace'; cwd?: string; label?: string }
  | { type: 'create-tab'; workspaceId: string; cwd?: string; label?: string }
  | { type: 'split-pane'; paneId: string; direction: 'right' | 'down' }
  | { type: 'rename-workspace'; workspaceId: string; label: string }
  | { type: 'close-workspace'; workspaceId: string }
  | { type: 'rename-tab'; tabId: string; label: string }
  | { type: 'close-tab'; tabId: string }
  | { type: 'rename-pane'; paneId: string; label?: string }
  | { type: 'close-pane'; paneId: string }
  | { type: 'zoom-pane'; paneId: string; mode?: 'toggle' | 'on' | 'off' }
  | {
      type: 'start-agent';
      paneId: string;
      name: string;
      kind: AgentKind;
      args?: string[];
      timeoutMs?: number;
    }
  | { type: 'move-workspace'; workspaceId: string; insertIndex: number }
  | { type: 'move-workspace-block'; workspaceIds: string[]; beforeWorkspaceId?: string }
  | {
      type: 'create-worktree';
      workspaceId?: string;
      cwd?: string;
      branch?: string;
      base?: string;
      path?: string;
      label?: string;
      focus?: boolean;
    }
  | {
      type: 'open-worktree';
      workspaceId?: string;
      cwd?: string;
      branch?: string;
      path?: string;
      label?: string;
      focus?: boolean;
    }
  | { type: 'remove-worktree'; workspaceId: string; force?: boolean }
  | { type: 'move-tab'; tabId: string; insertIndex: number }
  | { type: 'swap-pane'; paneId: string; direction: PaneDirection }
  | { type: 'swap-pane'; sourcePaneId: string; targetPaneId: string }
  | { type: 'move-pane'; paneId: string; destination: PaneMoveDestination; focus?: boolean }
  | { type: 'focus-pane-direction'; paneId: string; direction: PaneDirection }
  | { type: 'resize-pane'; paneId: string; direction: PaneDirection; amount?: number }
  | { type: 'set-split-ratio'; tabId?: string; paneId?: string; path: boolean[]; ratio: number }
  | { type: 'rename-agent'; target: string; name?: string }
  | { type: 'prompt-agent'; target: string; text: string; wait?: AgentPromptWait }
  | { type: 'send-pane-input'; paneId: string; text?: string; keys?: string[] }
  | {
      type: 'set-agent-view';
      source: string;
      label?: string;
      filter?: AgentViewFilter;
      sort?: AgentViewSort[];
    }
  | { type: 'clear-agent-view'; source?: string }
  | { type: 'install-integration'; target: IntegrationTarget }
  | { type: 'uninstall-integration'; target: IntegrationTarget }
  | { type: 'reload-server-config' }
  | { type: 'stop-server' }
  | {
      type: 'live-handoff-server';
      importExe?: string;
      expectedProtocol?: number;
      expectedVersion?: string;
    }
  | { type: 'reload-agent-manifests' }
  | {
      type: 'invoke-plugin-action';
      actionId: string;
      pluginId?: string;
      context?: PluginInvocationContext;
    }
  | {
      type: 'open-plugin-pane';
      pluginId: string;
      entrypoint: string;
      placement?: PluginPanePlacement;
      workspaceId?: string;
      targetPaneId?: string;
      direction?: SplitDirection;
      width?: PopupSize;
      height?: PopupSize;
      cwd?: string;
      focus?: boolean;
      env?: Record<string, string>;
    }
  | { type: 'focus-plugin-pane'; paneId: string }
  | { type: 'close-plugin-pane'; paneId: string }
  | { type: 'enable-plugin'; pluginId: string }
  | { type: 'disable-plugin'; pluginId: string };

export type PaneDirection = 'left' | 'right' | 'up' | 'down';
export type SplitDirection = 'right' | 'down';

export type PaneMoveDestination =
  | {
      type: 'tab';
      tabId: string;
      targetPaneId?: string;
      split: SplitDirection;
      ratio?: number;
    }
  | { type: 'new-tab'; workspaceId?: string; label?: string }
  | { type: 'new-workspace'; label?: string; tabLabel?: string };

export type AgentViewField =
  | 'status'
  | 'workspace_id'
  | 'tab_id'
  | 'pane_id'
  | 'agent'
  | 'seen'
  | 'state_change_seq'
  | { token: string };

export type AgentViewValue =
  | string
  | boolean
  | number
  | { context: 'current_workspace_id' | 'current_tab_id' };

export type AgentViewFilter =
  | { op: 'all'; filters: AgentViewFilter[] }
  | { op: 'any'; filters: AgentViewFilter[] }
  | { op: 'not'; filter: AgentViewFilter }
  | { op: 'eq'; field: AgentViewField; value: AgentViewValue }
  | { op: 'in'; field: AgentViewField; values: AgentViewValue[] }
  | { op: 'exists'; field: AgentViewField };

export type AgentViewSortField =
  | 'workspace_order'
  | 'tab_order'
  | 'pane_order'
  | 'attention'
  | 'status'
  | 'agent'
  | 'seen'
  | 'state_change_seq'
  | { token: string };

export interface AgentViewSort {
  field: AgentViewSortField;
  order?: 'asc' | 'desc';
}

export interface AgentPromptWait {
  until: Array<'idle' | 'working' | 'blocked' | 'done' | 'unknown'>;
  timeoutMs?: number;
}

export const INTEGRATION_TARGETS = [
  'pi',
  'omp',
  'claude',
  'codex',
  'copilot',
  'devin',
  'droid',
  'kimi',
  'opencode',
  'kilo',
  'hermes',
  'qodercli',
  'cursor',
  'mastracode',
  'antigravity_cli',
  'grok',
] as const;

export type IntegrationTarget = (typeof INTEGRATION_TARGETS)[number];
export type PluginPanePlacement = 'overlay' | 'popup' | 'split' | 'tab' | 'zoomed';
export type PopupSize = number | `${number}%`;

export interface PluginInvocationContext {
  workspaceId?: string;
  workspaceLabel?: string;
  workspaceCwd?: string;
  worktree?: {
    repoKey: string;
    repoName: string;
    repoRoot: string;
    checkoutPath: string;
    isLinkedWorktree: boolean;
  };
  tabId?: string;
  tabLabel?: string;
  focusedPaneId?: string;
  focusedPaneCwd?: string;
  focusedPaneAgent?: string;
  focusedPaneStatus?: 'idle' | 'working' | 'blocked' | 'done' | 'unknown';
  selectedText?: string;
  invocationSource?: string;
  correlationId?: string;
  clickedUrl?: string;
  linkHandlerId?: string;
}

export type HerdrQuery =
  | { type: 'read-pane-output'; paneId: string; lines?: number; ansi?: boolean }
  | { type: 'list-worktrees'; workspaceId?: string; cwd?: string }
  | { type: 'get-agent-manifests' }
  | { type: 'list-plugins'; pluginId?: string }
  | { type: 'list-plugin-actions'; pluginId?: string };

export interface WorktreeSourceInfo {
  repo_key: string;
  repo_name: string;
  repo_root: string;
  source_checkout_path: string;
  source_workspace_id?: string;
}

export interface WorktreeInfo {
  path: string;
  branch?: string;
  is_bare: boolean;
  is_detached: boolean;
  is_prunable: boolean;
  is_linked_worktree: boolean;
  open_workspace_id?: string;
  label: string;
}

export interface AgentManifestInfo {
  agent: string;
  source: string;
  source_kind: string;
  active_version?: string;
  cached_remote_version?: string;
  local_override_shadowing_remote: boolean;
  remote_update_result?: string;
  remote_update_error?: string;
  remote_last_checked_unix?: number;
  warning?: string;
}

export interface InstalledPluginInfo {
  plugin_id: string;
  name: string;
  version: string;
  min_herdr_version: string;
  description?: string;
  manifest_path: string;
  plugin_root: string;
  enabled: boolean;
  platforms?: PluginPlatform[];
  build: PluginCommandDefinition[];
  startup: PluginCommandDefinition[];
  actions: PluginManifestAction[];
  events: PluginManifestEvent[];
  panes: PluginManifestPane[];
  link_handlers: PluginManifestLinkHandler[];
  source: PluginSourceInfo;
  warnings: string[];
}

export type PluginPlatform = 'linux' | 'macos' | 'windows';
export type PluginActionContext = 'global' | 'workspace' | 'tab' | 'pane' | 'selection';

export interface PluginCommandDefinition {
  platforms?: PluginPlatform[];
  command: string[];
}

export interface PluginManifestAction extends PluginCommandDefinition {
  id: string;
  title: string;
  description?: string;
  contexts: PluginActionContext[];
}

export interface PluginManifestEvent extends PluginCommandDefinition {
  on: string;
}

export interface PluginManifestPane extends PluginCommandDefinition {
  id: string;
  title: string;
  description?: string;
  placement: PluginPanePlacement;
  width?: PopupSize;
  height?: PopupSize;
}

export interface PluginManifestLinkHandler {
  id: string;
  title: string;
  pattern: string;
  action: string;
  platforms?: PluginPlatform[];
}

export interface PluginSourceInfo {
  kind: 'local' | 'github';
  owner?: string;
  repo?: string;
  subdir?: string;
  requested_ref?: string;
  resolved_commit?: string;
  managed_path?: string;
  installed_unix_ms?: number;
}

export interface PluginActionInfo {
  plugin_id: string;
  action_id: string;
  title: string;
  description?: string;
  contexts: PluginActionContext[];
  command: string[];
  platforms?: PluginPlatform[];
}

export type HerdrQueryResult =
  | {
      type: 'pane-output';
      paneId: string;
      workspaceId: string;
      tabId: string;
      text: string;
      revision: number;
      truncated: boolean;
    }
  | { type: 'worktree-list'; source: WorktreeSourceInfo; worktrees: WorktreeInfo[] }
  | {
      type: 'agent-manifests';
      last_check_unix?: number;
      last_result?: string;
      manifests: AgentManifestInfo[];
    }
  | { type: 'plugin-list'; plugins: InstalledPluginInfo[] }
  | { type: 'plugin-action-list'; actions: PluginActionInfo[] };

export const AGENT_KINDS = [
  'pi',
  'claude',
  'codex',
  'gemini',
  'cursor',
  'devin',
  'agy',
  'cline',
  'omp',
  'mastracode',
  'opencode',
  'copilot',
  'kimi',
  'kiro',
  'droid',
  'amp',
  'grok',
  'hermes',
  'kilo',
  'qodercli',
  'maki',
] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];
export type DesktopAction =
  | 'open-settings'
  | 'open-navigator'
  | 'open-shortcuts'
  | 'open-whats-new'
  | 'open-plugins'
  | 'refresh'
  | 'reload-config'
  | 'new-workspace'
  | 'new-tab'
  | 'previous-workspace'
  | 'next-workspace'
  | 'previous-tab'
  | 'next-tab'
  | 'focus-pane-left'
  | 'focus-pane-right'
  | 'focus-pane-up'
  | 'focus-pane-down'
  | 'split-pane-right'
  | 'split-pane-down'
  | 'toggle-pane-zoom';

export interface HerdrDesktopApi {
  bootstrap(): Promise<EngineBootstrap>;
  startServer(): Promise<EngineBootstrap>;
  command(command: HerdrCommand): Promise<EngineBootstrap>;
  query(query: HerdrQuery): Promise<HerdrQueryResult>;
  stageChatImages(images: ChatImageDraft[]): Promise<string[]>;
  readPreferences(): Promise<DesktopPreferences>;
  writePreferences(preferences: DesktopPreferences): Promise<DesktopPreferences>;
  chooseHerdrBinary(): Promise<EngineBootstrap | null>;
  resetHerdrBinary(): Promise<EngineBootstrap>;
  onDesktopAction(listener: (action: DesktopAction) => void): () => void;
  onSessionEvent(listener: (event: HerdrEventEnvelope) => void): () => void;
  terminal: {
    open(request: TerminalOpenRequest): Promise<void>;
    input(request: TerminalInputRequest): Promise<void>;
    resize(request: TerminalResizeRequest): Promise<void>;
    scroll(request: TerminalScrollRequest): Promise<void>;
    close(paneId: string): Promise<void>;
    onEvent(listener: (event: TerminalEvent) => void): () => void;
  };
  openExternal(url: string): Promise<void>;
}
