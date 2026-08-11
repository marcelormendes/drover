import type { ConversationCapability, ConversationSessionIdentity } from '@/shared/conversation';

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export interface HerdrClientStatus {
  version: string;
  channel: string;
  protocol: number;
  binary: string;
  session: string | null;
}

export interface HerdrServerStatus {
  status: string;
  running: boolean;
  version: string | null;
  protocol: number | null;
  capabilities: {
    live_handoff: boolean;
    detached_server_daemon: boolean;
    agent_conversations?: boolean;
  } | null;
  compatible: boolean | null;
  socket: string;
  session: string | null;
  restart_needed: boolean | null;
}

export interface HerdrStatus {
  client: HerdrClientStatus;
  server: HerdrServerStatus;
  update: { restart_needed: boolean | null };
}

export interface WorkspaceInfo {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string;
  agent_status: AgentStatus;
  tokens: Record<string, string>;
  worktree?: {
    repo_key: string;
    repo_name: string;
    repo_root: string;
    checkout_path: string;
    is_linked_worktree: boolean;
  };
}

export interface TabInfo {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  agent_status: AgentStatus;
}

export interface PaneInfo {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd?: string;
  foreground_cwd?: string;
  label?: string;
  agent?: string;
  title?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  display_agent?: string;
  agent_status: AgentStatus;
  state_labels: Record<string, string>;
  tokens: Record<string, string>;
  agent_session?: {
    source: string;
    agent: string;
    kind: string;
    value: string;
  };
  conversation_session?: ConversationSessionIdentity;
  conversation_capability?: ConversationCapability;
  scroll?: {
    offset_from_bottom: number;
    max_offset_from_bottom: number;
    viewport_rows: number;
  };
  revision: number;
}

export interface AgentInfo {
  terminal_id: string;
  name?: string;
  agent?: string;
  title?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  display_agent?: string;
  agent_status: AgentStatus;
  screen_detection_skipped: boolean;
  state_labels: Record<string, string>;
  tokens: Record<string, string>;
  agent_session?: {
    source: string;
    agent: string;
    kind: string;
    value: string;
  };
  conversation_session?: ConversationSessionIdentity;
  conversation_capability?: ConversationCapability;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
  focused: boolean;
  launch_pending: boolean;
  interactive_ready: boolean;
  state_change_seq: number;
  cwd?: string;
  foreground_cwd?: string;
  revision: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaneLayoutSnapshot {
  workspace_id: string;
  tab_id: string;
  zoomed: boolean;
  area: LayoutRect;
  focused_pane_id: string;
  panes: Array<{ pane_id: string; focused: boolean; rect: LayoutRect }>;
  splits: Array<{
    id: string;
    direction: 'right' | 'down';
    ratio: number;
    rect: LayoutRect;
  }>;
}

export interface SessionSnapshot {
  version: string;
  protocol: number;
  focused_workspace_id?: string;
  focused_tab_id?: string;
  focused_pane_id?: string;
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  layouts: PaneLayoutSnapshot[];
  agents: AgentInfo[];
}

export type EngineBootstrap =
  | { state: 'connected'; status: HerdrStatus; snapshot: SessionSnapshot }
  | { state: 'stopped'; status: HerdrStatus }
  | { state: 'incompatible'; status: HerdrStatus }
  | { state: 'missing'; message: string }
  | { state: 'error'; message: string; details?: string };
