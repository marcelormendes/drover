import type {
  ConversationCapability,
  ConversationReasonCode,
  ConversationSessionIdentity,
} from '@/shared/conversation';
import type {
  AgentInfo,
  AgentStatus,
  LayoutRect,
  PaneInfo,
  PaneLayoutSnapshot,
  SessionSnapshot,
  TabInfo,
  WorkspaceInfo,
} from '@/shared/herdr';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isAgentStatus(value: unknown): value is AgentStatus {
  return (
    value === 'idle' ||
    value === 'working' ||
    value === 'blocked' ||
    value === 'done' ||
    value === 'unknown'
  );
}

function stringMap(value: unknown): Record<string, string> | null {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value) || !Object.values(value).every(isString)) {
    return null;
  }
  return value as Record<string, string>;
}

function opaque(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\\/]/.test(value)
    ? value
    : null;
}

function conversationSession(value: unknown): ConversationSessionIdentity | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return null;
  }
  const id = opaque(value.id);
  return id ? { id } : null;
}

function conversationCapability(value: unknown): ConversationCapability | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return null;
  }
  const availability = value.availability;
  const reasons: ConversationReasonCode[] = [
    'ready',
    'adapter_missing',
    'no_session',
    'transcript_missing',
    'transcript_invalid',
    'source_unreadable',
  ];
  if (
    (availability !== 'supported' &&
      availability !== 'unavailable' &&
      availability !== 'unsupported') ||
    !reasons.includes(value.reason as ConversationReasonCode) ||
    (value.message !== undefined && typeof value.message !== 'string')
  ) {
    return null;
  }
  return {
    availability,
    reason: value.reason as ConversationReasonCode,
    ...(value.message === undefined ? {} : { message: value.message }),
  };
}

function agentSession(value: unknown): PaneInfo['agent_session'] | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    !isString(value.source) ||
    !isString(value.agent) ||
    (value.kind !== 'id' && value.kind !== 'path') ||
    !isString(value.value)
  ) {
    return null;
  }
  return {
    source: value.source,
    agent: value.agent,
    kind: value.kind,
    value: value.value,
  };
}

function workspace(value: unknown): WorkspaceInfo | null {
  if (!isRecord(value)) {
    return null;
  }
  const tokens = stringMap(value.tokens);
  if (
    !isString(value.workspace_id) ||
    !isNonNegativeInteger(value.number) ||
    !isString(value.label) ||
    !isBoolean(value.focused) ||
    !isNonNegativeInteger(value.pane_count) ||
    !isNonNegativeInteger(value.tab_count) ||
    !isString(value.active_tab_id) ||
    !isAgentStatus(value.agent_status) ||
    tokens === null
  ) {
    return null;
  }

  let worktree: WorkspaceInfo['worktree'];
  if (value.worktree !== undefined) {
    if (
      !isRecord(value.worktree) ||
      !isString(value.worktree.repo_key) ||
      !isString(value.worktree.repo_name) ||
      !isString(value.worktree.repo_root) ||
      !isString(value.worktree.checkout_path) ||
      !isBoolean(value.worktree.is_linked_worktree)
    ) {
      return null;
    }
    worktree = {
      repo_key: value.worktree.repo_key,
      repo_name: value.worktree.repo_name,
      repo_root: value.worktree.repo_root,
      checkout_path: value.worktree.checkout_path,
      is_linked_worktree: value.worktree.is_linked_worktree,
    };
  }

  return {
    workspace_id: value.workspace_id,
    number: value.number,
    label: value.label,
    focused: value.focused,
    pane_count: value.pane_count,
    tab_count: value.tab_count,
    active_tab_id: value.active_tab_id,
    agent_status: value.agent_status,
    tokens,
    ...(worktree ? { worktree } : {}),
  };
}

function tab(value: unknown): TabInfo | null {
  if (
    !isRecord(value) ||
    !isString(value.tab_id) ||
    !isString(value.workspace_id) ||
    !isNonNegativeInteger(value.number) ||
    !isString(value.label) ||
    !isBoolean(value.focused) ||
    !isNonNegativeInteger(value.pane_count) ||
    !isAgentStatus(value.agent_status)
  ) {
    return null;
  }
  return {
    tab_id: value.tab_id,
    workspace_id: value.workspace_id,
    number: value.number,
    label: value.label,
    focused: value.focused,
    pane_count: value.pane_count,
    agent_status: value.agent_status,
  };
}

function pane(value: unknown): PaneInfo | null {
  if (!isRecord(value)) {
    return null;
  }
  const stateLabels = stringMap(value.state_labels);
  const tokens = stringMap(value.tokens);
  const session = agentSession(value.agent_session);
  const conversation_session = conversationSession(value.conversation_session);
  const conversation_capability = conversationCapability(value.conversation_capability);
  if (
    !isString(value.pane_id) ||
    !isString(value.terminal_id) ||
    !isString(value.workspace_id) ||
    !isString(value.tab_id) ||
    !isBoolean(value.focused) ||
    !isOptionalString(value.cwd) ||
    !isOptionalString(value.foreground_cwd) ||
    !isOptionalString(value.label) ||
    !isOptionalString(value.agent) ||
    !isOptionalString(value.title) ||
    !isOptionalString(value.terminal_title) ||
    !isOptionalString(value.terminal_title_stripped) ||
    !isOptionalString(value.display_agent) ||
    !isAgentStatus(value.agent_status) ||
    stateLabels === null ||
    tokens === null ||
    session === null ||
    conversation_session === null ||
    conversation_capability === null ||
    !isNonNegativeInteger(value.revision)
  ) {
    return null;
  }

  let scroll: PaneInfo['scroll'];
  if (value.scroll !== undefined) {
    if (
      !isRecord(value.scroll) ||
      !isNonNegativeInteger(value.scroll.offset_from_bottom) ||
      !isNonNegativeInteger(value.scroll.max_offset_from_bottom) ||
      !isNonNegativeInteger(value.scroll.viewport_rows)
    ) {
      return null;
    }
    scroll = {
      offset_from_bottom: value.scroll.offset_from_bottom,
      max_offset_from_bottom: value.scroll.max_offset_from_bottom,
      viewport_rows: value.scroll.viewport_rows,
    };
  }

  return {
    pane_id: value.pane_id,
    terminal_id: value.terminal_id,
    workspace_id: value.workspace_id,
    tab_id: value.tab_id,
    focused: value.focused,
    ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
    ...(value.foreground_cwd === undefined ? {} : { foreground_cwd: value.foreground_cwd }),
    ...(value.label === undefined ? {} : { label: value.label }),
    ...(value.agent === undefined ? {} : { agent: value.agent }),
    ...(value.title === undefined ? {} : { title: value.title }),
    ...(value.terminal_title === undefined ? {} : { terminal_title: value.terminal_title }),
    ...(value.terminal_title_stripped === undefined
      ? {}
      : { terminal_title_stripped: value.terminal_title_stripped }),
    ...(value.display_agent === undefined ? {} : { display_agent: value.display_agent }),
    agent_status: value.agent_status,
    state_labels: stateLabels,
    tokens,
    ...(session === undefined ? {} : { agent_session: session }),
    ...(conversation_session === undefined ? {} : { conversation_session }),
    ...(conversation_capability === undefined ? {} : { conversation_capability }),
    ...(scroll === undefined ? {} : { scroll }),
    revision: value.revision,
  };
}

function rect(value: unknown): LayoutRect | null {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.x) ||
    !isNonNegativeInteger(value.y) ||
    !isNonNegativeInteger(value.width) ||
    !isNonNegativeInteger(value.height) ||
    value.x > 65_535 ||
    value.y > 65_535 ||
    value.width > 65_535 ||
    value.height > 65_535
  ) {
    return null;
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function layout(value: unknown): PaneLayoutSnapshot | null {
  if (
    !isRecord(value) ||
    !isString(value.workspace_id) ||
    !isString(value.tab_id) ||
    !isBoolean(value.zoomed) ||
    !isString(value.focused_pane_id) ||
    !Array.isArray(value.panes) ||
    !Array.isArray(value.splits)
  ) {
    return null;
  }
  const area = rect(value.area);
  if (!area) {
    return null;
  }
  const panes: PaneLayoutSnapshot['panes'] = [];
  for (const item of value.panes) {
    if (!isRecord(item) || !isString(item.pane_id) || !isBoolean(item.focused)) {
      return null;
    }
    const itemRect = rect(item.rect);
    if (!itemRect) {
      return null;
    }
    panes.push({ pane_id: item.pane_id, focused: item.focused, rect: itemRect });
  }
  const splits: PaneLayoutSnapshot['splits'] = [];
  for (const item of value.splits) {
    if (
      !isRecord(item) ||
      !isString(item.id) ||
      (item.direction !== 'right' && item.direction !== 'down') ||
      !isFiniteNumber(item.ratio) ||
      item.ratio <= 0 ||
      item.ratio >= 1
    ) {
      return null;
    }
    const itemRect = rect(item.rect);
    if (!itemRect) {
      return null;
    }
    splits.push({ id: item.id, direction: item.direction, ratio: item.ratio, rect: itemRect });
  }
  return {
    workspace_id: value.workspace_id,
    tab_id: value.tab_id,
    zoomed: value.zoomed,
    area,
    focused_pane_id: value.focused_pane_id,
    panes,
    splits,
  };
}

function agent(value: unknown): AgentInfo | null {
  if (!isRecord(value)) {
    return null;
  }
  const stateLabels = stringMap(value.state_labels);
  const tokens = stringMap(value.tokens);
  const session = agentSession(value.agent_session);
  const conversation_session = conversationSession(value.conversation_session);
  const conversation_capability = conversationCapability(value.conversation_capability);
  const screenDetectionSkipped = value.screen_detection_skipped ?? false;
  const launchPending = value.launch_pending ?? false;
  const interactiveReady = value.interactive_ready ?? false;
  const stateChangeSeq = value.state_change_seq ?? 0;
  if (
    !isString(value.terminal_id) ||
    !isOptionalString(value.name) ||
    !isOptionalString(value.agent) ||
    !isOptionalString(value.title) ||
    !isOptionalString(value.terminal_title) ||
    !isOptionalString(value.terminal_title_stripped) ||
    !isOptionalString(value.display_agent) ||
    !isAgentStatus(value.agent_status) ||
    !isBoolean(screenDetectionSkipped) ||
    stateLabels === null ||
    tokens === null ||
    session === null ||
    conversation_session === null ||
    conversation_capability === null ||
    !isString(value.workspace_id) ||
    !isString(value.tab_id) ||
    !isString(value.pane_id) ||
    !isBoolean(value.focused) ||
    !isBoolean(launchPending) ||
    !isBoolean(interactiveReady) ||
    !isNonNegativeInteger(stateChangeSeq) ||
    !isOptionalString(value.cwd) ||
    !isOptionalString(value.foreground_cwd) ||
    !isNonNegativeInteger(value.revision)
  ) {
    return null;
  }
  return {
    terminal_id: value.terminal_id,
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.agent === undefined ? {} : { agent: value.agent }),
    ...(value.title === undefined ? {} : { title: value.title }),
    ...(value.terminal_title === undefined ? {} : { terminal_title: value.terminal_title }),
    ...(value.terminal_title_stripped === undefined
      ? {}
      : { terminal_title_stripped: value.terminal_title_stripped }),
    ...(value.display_agent === undefined ? {} : { display_agent: value.display_agent }),
    agent_status: value.agent_status,
    screen_detection_skipped: screenDetectionSkipped,
    state_labels: stateLabels,
    tokens,
    ...(session === undefined ? {} : { agent_session: session }),
    ...(conversation_session === undefined ? {} : { conversation_session }),
    ...(conversation_capability === undefined ? {} : { conversation_capability }),
    workspace_id: value.workspace_id,
    tab_id: value.tab_id,
    pane_id: value.pane_id,
    focused: value.focused,
    launch_pending: launchPending,
    interactive_ready: interactiveReady,
    state_change_seq: stateChangeSeq,
    ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
    ...(value.foreground_cwd === undefined ? {} : { foreground_cwd: value.foreground_cwd }),
    revision: value.revision,
  };
}

function decodeArray<T>(value: unknown, decode: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const decoded: T[] = [];
  for (const item of value) {
    const result = decode(item);
    if (result === null) {
      return null;
    }
    decoded.push(result);
  }
  return decoded;
}

export function decodeSessionSnapshot(value: unknown): SessionSnapshot | null {
  if (
    !isRecord(value) ||
    !isString(value.version) ||
    !isNonNegativeInteger(value.protocol) ||
    !isOptionalString(value.focused_workspace_id) ||
    !isOptionalString(value.focused_tab_id) ||
    !isOptionalString(value.focused_pane_id)
  ) {
    return null;
  }
  const workspaces = decodeArray(value.workspaces, workspace);
  const tabs = decodeArray(value.tabs, tab);
  const panes = decodeArray(value.panes, pane);
  const layouts = decodeArray(value.layouts, layout);
  const agents = decodeArray(value.agents, agent);
  if (!workspaces || !tabs || !panes || !layouts || !agents) {
    return null;
  }
  return {
    version: value.version,
    protocol: value.protocol,
    ...(value.focused_workspace_id === undefined
      ? {}
      : { focused_workspace_id: value.focused_workspace_id }),
    ...(value.focused_tab_id === undefined ? {} : { focused_tab_id: value.focused_tab_id }),
    ...(value.focused_pane_id === undefined ? {} : { focused_pane_id: value.focused_pane_id }),
    workspaces,
    tabs,
    panes,
    layouts,
    agents,
  };
}
