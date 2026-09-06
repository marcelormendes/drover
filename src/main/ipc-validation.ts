import type {
  ConversationAttachmentAbortRequest,
  ConversationAttachmentBeginRequest,
  ConversationAttachmentChunkRequest,
  ConversationAttachmentFinishRequest,
  ConversationPromptRequest,
  ConversationReadRequest,
  ConversationRespondRequest,
} from '@/shared/conversation';
import {
  AGENT_KINDS,
  type AgentViewField,
  type AgentViewFilter,
  type AgentViewSort,
  type AgentViewValue,
  type HerdrCommand,
  type HerdrQuery,
  INTEGRATION_TARGETS,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  type PaneMoveDestination,
} from '@/shared/desktop-api';
import { MAX_REMOTE_ENGINE_PORT, type RemoteEngineTarget } from '@/shared/remote-engine';
import type {
  TerminalInputRequest,
  TerminalOpenRequest,
  TerminalResizeRequest,
  TerminalScrollRequest,
} from '@/shared/terminal';

// Herdr encodes stable public counters with
// 123456789ABCDEFGHJKMNPQRSTVWXYZ0, so the tenth ID is `A` rather than `10`.
const PUBLIC_ID_NUMBER = '[123456789ABCDEFGHJKMNPQRSTVWXYZ0]+';
const WORKSPACE_ID = new RegExp(`^w${PUBLIC_ID_NUMBER}$`);
const TAB_ID = new RegExp(`^w${PUBLIC_ID_NUMBER}:t${PUBLIC_ID_NUMBER}$`);
const PANE_ID = new RegExp(`^w${PUBLIC_ID_NUMBER}:p${PUBLIC_ID_NUMBER}$`);
const MAX_TEXT_LENGTH = 4_096;
const MAX_TERMINAL_INPUT_LENGTH = 1_048_576;
const MAX_TERMINAL_DIMENSION = 1_000;
const MAX_COLLECTION_LENGTH = 1_000;
const MAX_FILTER_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalBase64(data: string): boolean {
  if (data.length === 0 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return false;
  }
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const body = data.length - padding;
  if (padding === 1 && data[body - 1] === '=') {
    return false;
  }
  if (padding === 0) {
    return true;
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const value = alphabet.indexOf(data[body - 1]);
  return padding === 2 ? (value & 0x0f) === 0 : (value & 0x03) === 0;
}

function optionalText(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length <= MAX_TEXT_LENGTH);
}

function requiredText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function validDimension(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_TERMINAL_DIMENSION
  );
}

function validIdentifier(value: unknown): value is string {
  return requiredText(value);
}

function optionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function nonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function positiveInteger(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0;
}

function validOpaque(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\\/]/.test(value)
  );
}

function validAgentArguments(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_COLLECTION_LENGTH &&
    value.every((argument) => typeof argument === 'string' && argument.length <= MAX_TEXT_LENGTH)
  );
}

function validAgentStartupTimeout(value: unknown): value is number {
  return positiveInteger(value) && value > 3_000 && value <= 300_000;
}

function validRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1;
}

function validResizeAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
}

function validDirection(value: unknown): value is 'left' | 'right' | 'up' | 'down' {
  return value === 'left' || value === 'right' || value === 'up' || value === 'down';
}

function validSplitDirection(value: unknown): value is 'right' | 'down' {
  return value === 'right' || value === 'down';
}

function validStringMap(value: unknown): value is Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length > MAX_COLLECTION_LENGTH) {
    return false;
  }
  return Object.entries(value).every(
    ([key, item]) =>
      requiredText(key) && typeof item === 'string' && item.length <= MAX_TEXT_LENGTH,
  );
}

function validAgentViewField(value: unknown): value is AgentViewField {
  if (
    value === 'status' ||
    value === 'workspace_id' ||
    value === 'tab_id' ||
    value === 'pane_id' ||
    value === 'agent' ||
    value === 'seen' ||
    value === 'state_change_seq'
  ) {
    return true;
  }
  return isRecord(value) && requiredText(value.token);
}

function validAgentViewSortField(value: unknown): boolean {
  return (
    value === 'workspace_order' ||
    value === 'tab_order' ||
    value === 'pane_order' ||
    value === 'attention' ||
    value === 'status' ||
    value === 'agent' ||
    value === 'seen' ||
    value === 'state_change_seq' ||
    (isRecord(value) && requiredText(value.token))
  );
}

function validAgentViewValue(value: unknown): value is AgentViewValue {
  return (
    (typeof value === 'string' && value.length <= MAX_TEXT_LENGTH) ||
    typeof value === 'boolean' ||
    nonNegativeInteger(value) ||
    (isRecord(value) &&
      (value.context === 'current_workspace_id' || value.context === 'current_tab_id'))
  );
}

function validAgentStatus(value: unknown): boolean {
  return (
    value === 'idle' ||
    value === 'working' ||
    value === 'blocked' ||
    value === 'done' ||
    value === 'unknown'
  );
}

function validPopupSize(value: unknown): boolean {
  return (
    (nonNegativeInteger(value) && value <= 65_535) ||
    (typeof value === 'string' && /^(100|[1-9][0-9]?)%$/.test(value))
  );
}

function validPluginInvocationContext(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const optionalFields = [
    value.workspaceLabel,
    value.workspaceCwd,
    value.tabLabel,
    value.focusedPaneCwd,
    value.focusedPaneAgent,
    value.selectedText,
    value.invocationSource,
    value.correlationId,
    value.clickedUrl,
    value.linkHandlerId,
  ];
  if (!optionalFields.every(optionalText)) {
    return false;
  }
  if (
    (value.workspaceId !== undefined &&
      (typeof value.workspaceId !== 'string' || !WORKSPACE_ID.test(value.workspaceId))) ||
    (value.tabId !== undefined && (typeof value.tabId !== 'string' || !TAB_ID.test(value.tabId))) ||
    (value.focusedPaneId !== undefined &&
      (typeof value.focusedPaneId !== 'string' || !PANE_ID.test(value.focusedPaneId))) ||
    (value.focusedPaneStatus !== undefined && !validAgentStatus(value.focusedPaneStatus))
  ) {
    return false;
  }
  if (value.worktree === undefined) {
    return true;
  }
  return (
    isRecord(value.worktree) &&
    requiredText(value.worktree.repoKey) &&
    requiredText(value.worktree.repoName) &&
    requiredText(value.worktree.repoRoot) &&
    requiredText(value.worktree.checkoutPath) &&
    typeof value.worktree.isLinkedWorktree === 'boolean'
  );
}

function validAgentViewFilter(value: unknown, depth = 0): value is AgentViewFilter {
  if (!isRecord(value) || depth > MAX_FILTER_DEPTH) {
    return false;
  }
  if (value.op === 'all' || value.op === 'any') {
    return (
      Array.isArray(value.filters) &&
      value.filters.length <= MAX_COLLECTION_LENGTH &&
      value.filters.every((filter) => validAgentViewFilter(filter, depth + 1))
    );
  }
  if (value.op === 'not') {
    return validAgentViewFilter(value.filter, depth + 1);
  }
  if (value.op === 'eq') {
    return validAgentViewField(value.field) && validAgentViewValue(value.value);
  }
  if (value.op === 'in') {
    return (
      validAgentViewField(value.field) &&
      Array.isArray(value.values) &&
      value.values.length <= MAX_COLLECTION_LENGTH &&
      value.values.every(validAgentViewValue)
    );
  }
  return value.op === 'exists' && validAgentViewField(value.field);
}

function validAgentViewSort(value: unknown): value is AgentViewSort[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_COLLECTION_LENGTH &&
    value.every(
      (item) =>
        isRecord(item) &&
        validAgentViewSortField(item.field) &&
        (item.order === undefined || item.order === 'asc' || item.order === 'desc'),
    )
  );
}

function validPaneMoveDestination(value: unknown): value is PaneMoveDestination {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === 'tab') {
    return (
      typeof value.tabId === 'string' &&
      TAB_ID.test(value.tabId) &&
      (value.targetPaneId === undefined ||
        (typeof value.targetPaneId === 'string' && PANE_ID.test(value.targetPaneId))) &&
      validSplitDirection(value.split) &&
      (value.ratio === undefined || validRatio(value.ratio))
    );
  }
  if (value.type === 'new-tab') {
    return (
      (value.workspaceId === undefined ||
        (typeof value.workspaceId === 'string' && WORKSPACE_ID.test(value.workspaceId))) &&
      optionalText(value.label)
    );
  }
  return (
    value.type === 'new-workspace' && optionalText(value.label) && optionalText(value.tabLabel)
  );
}

function validAgentPromptWait(value: unknown): boolean {
  const statuses = ['idle', 'working', 'blocked', 'done', 'unknown'];
  return (
    isRecord(value) &&
    Array.isArray(value.until) &&
    value.until.length > 0 &&
    value.until.length <= statuses.length &&
    value.until.every((status) => statuses.includes(status)) &&
    new Set(value.until).size === value.until.length &&
    (value.timeoutMs === undefined || positiveInteger(value.timeoutMs))
  );
}

export function parseHerdrCommand(value: unknown): HerdrCommand {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('Invalid Herdr command.');
  }

  switch (value.type) {
    case 'focus-workspace':
      if (typeof value.workspaceId === 'string' && WORKSPACE_ID.test(value.workspaceId)) {
        return { type: value.type, workspaceId: value.workspaceId };
      }
      break;
    case 'focus-tab':
      if (typeof value.tabId === 'string' && TAB_ID.test(value.tabId)) {
        return { type: value.type, tabId: value.tabId };
      }
      break;
    case 'focus-pane':
      if (typeof value.paneId === 'string' && PANE_ID.test(value.paneId)) {
        return { type: value.type, paneId: value.paneId };
      }
      break;
    case 'create-workspace':
      if (optionalText(value.cwd) && optionalText(value.label)) {
        return { type: value.type, cwd: value.cwd, label: value.label };
      }
      break;
    case 'create-tab':
      if (
        typeof value.workspaceId === 'string' &&
        WORKSPACE_ID.test(value.workspaceId) &&
        optionalText(value.cwd) &&
        optionalText(value.label)
      ) {
        return {
          type: value.type,
          workspaceId: value.workspaceId,
          cwd: value.cwd,
          label: value.label,
        };
      }
      break;
    case 'split-pane':
      if (
        typeof value.paneId === 'string' &&
        PANE_ID.test(value.paneId) &&
        (value.direction === 'right' || value.direction === 'down')
      ) {
        return { type: value.type, paneId: value.paneId, direction: value.direction };
      }
      break;
    case 'rename-workspace':
      if (
        typeof value.workspaceId === 'string' &&
        WORKSPACE_ID.test(value.workspaceId) &&
        requiredText(value.label)
      ) {
        return { type: value.type, workspaceId: value.workspaceId, label: value.label };
      }
      break;
    case 'close-workspace':
      if (typeof value.workspaceId === 'string' && WORKSPACE_ID.test(value.workspaceId)) {
        return { type: value.type, workspaceId: value.workspaceId };
      }
      break;
    case 'rename-tab':
      if (
        typeof value.tabId === 'string' &&
        TAB_ID.test(value.tabId) &&
        requiredText(value.label)
      ) {
        return { type: value.type, tabId: value.tabId, label: value.label };
      }
      break;
    case 'close-tab':
      if (typeof value.tabId === 'string' && TAB_ID.test(value.tabId)) {
        return { type: value.type, tabId: value.tabId };
      }
      break;
    case 'rename-pane':
      if (
        typeof value.paneId === 'string' &&
        PANE_ID.test(value.paneId) &&
        optionalText(value.label)
      ) {
        return { type: value.type, paneId: value.paneId, label: value.label };
      }
      break;
    case 'close-pane':
      if (typeof value.paneId === 'string' && PANE_ID.test(value.paneId)) {
        return { type: value.type, paneId: value.paneId };
      }
      break;
    case 'zoom-pane':
      if (
        typeof value.paneId === 'string' &&
        PANE_ID.test(value.paneId) &&
        (value.mode === undefined ||
          value.mode === 'toggle' ||
          value.mode === 'on' ||
          value.mode === 'off')
      ) {
        return { type: value.type, paneId: value.paneId, mode: value.mode };
      }
      break;
    case 'start-agent':
      if (
        typeof value.paneId === 'string' &&
        PANE_ID.test(value.paneId) &&
        typeof value.name === 'string' &&
        /^[a-z][a-z0-9_-]{0,31}$/.test(value.name) &&
        typeof value.kind === 'string' &&
        AGENT_KINDS.includes(value.kind as (typeof AGENT_KINDS)[number]) &&
        (value.args === undefined || validAgentArguments(value.args)) &&
        (value.timeoutMs === undefined || validAgentStartupTimeout(value.timeoutMs))
      ) {
        return {
          type: value.type,
          paneId: value.paneId,
          name: value.name,
          kind: value.kind as (typeof AGENT_KINDS)[number],
          ...(value.args === undefined ? {} : { args: value.args }),
          ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs }),
        };
      }
      break;
    case 'move-workspace':
      if (
        typeof value.workspaceId === 'string' &&
        WORKSPACE_ID.test(value.workspaceId) &&
        nonNegativeInteger(value.insertIndex)
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'move-workspace-block':
      if (
        Array.isArray(value.workspaceIds) &&
        value.workspaceIds.length > 0 &&
        value.workspaceIds.length <= MAX_COLLECTION_LENGTH &&
        value.workspaceIds.every((id) => typeof id === 'string' && WORKSPACE_ID.test(id)) &&
        new Set(value.workspaceIds).size === value.workspaceIds.length &&
        (value.beforeWorkspaceId === undefined ||
          (typeof value.beforeWorkspaceId === 'string' &&
            WORKSPACE_ID.test(value.beforeWorkspaceId) &&
            !value.workspaceIds.includes(value.beforeWorkspaceId)))
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'create-worktree':
      if (
        (value.workspaceId === undefined ||
          (typeof value.workspaceId === 'string' && WORKSPACE_ID.test(value.workspaceId))) &&
        optionalText(value.cwd) &&
        optionalText(value.branch) &&
        optionalText(value.base) &&
        optionalText(value.path) &&
        optionalText(value.label) &&
        optionalBoolean(value.focus)
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'open-worktree':
      if (
        (value.workspaceId === undefined ||
          (typeof value.workspaceId === 'string' && WORKSPACE_ID.test(value.workspaceId))) &&
        optionalText(value.cwd) &&
        optionalText(value.branch) &&
        optionalText(value.path) &&
        optionalText(value.label) &&
        optionalBoolean(value.focus)
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'remove-worktree':
      if (
        typeof value.workspaceId === 'string' &&
        WORKSPACE_ID.test(value.workspaceId) &&
        optionalBoolean(value.force)
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'move-tab':
      if (
        typeof value.tabId === 'string' &&
        TAB_ID.test(value.tabId) &&
        nonNegativeInteger(value.insertIndex)
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'swap-pane': {
      const directional =
        typeof value.paneId === 'string' &&
        PANE_ID.test(value.paneId) &&
        validDirection(value.direction) &&
        value.sourcePaneId === undefined &&
        value.targetPaneId === undefined;
      const explicit =
        typeof value.sourcePaneId === 'string' &&
        PANE_ID.test(value.sourcePaneId) &&
        typeof value.targetPaneId === 'string' &&
        PANE_ID.test(value.targetPaneId) &&
        value.sourcePaneId !== value.targetPaneId &&
        value.paneId === undefined &&
        value.direction === undefined;
      if (directional || explicit) {
        return value as unknown as HerdrCommand;
      }
      break;
    }
    case 'move-pane':
      if (
        typeof value.paneId === 'string' &&
        PANE_ID.test(value.paneId) &&
        validPaneMoveDestination(value.destination) &&
        optionalBoolean(value.focus)
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'focus-pane-direction':
      if (
        typeof value.paneId === 'string' &&
        PANE_ID.test(value.paneId) &&
        validDirection(value.direction)
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'resize-pane':
      if (
        typeof value.paneId === 'string' &&
        PANE_ID.test(value.paneId) &&
        validDirection(value.direction) &&
        (value.amount === undefined || validResizeAmount(value.amount))
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'set-split-ratio':
      if (
        (typeof value.tabId === 'string' && TAB_ID.test(value.tabId)) !==
          (typeof value.paneId === 'string' && PANE_ID.test(value.paneId)) &&
        Array.isArray(value.path) &&
        value.path.length <= MAX_COLLECTION_LENGTH &&
        value.path.every((part) => typeof part === 'boolean') &&
        validRatio(value.ratio)
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'rename-agent':
      if (
        validIdentifier(value.target) &&
        (value.name === undefined || validIdentifier(value.name))
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'prompt-agent':
      if (
        validIdentifier(value.target) &&
        requiredText(value.text) &&
        (value.wait === undefined || validAgentPromptWait(value.wait))
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'send-pane-input':
      if (
        typeof value.paneId === 'string' &&
        PANE_ID.test(value.paneId) &&
        (value.text === undefined || requiredText(value.text)) &&
        (value.keys === undefined ||
          (Array.isArray(value.keys) &&
            value.keys.length > 0 &&
            value.keys.length <= MAX_COLLECTION_LENGTH &&
            value.keys.every((key) => requiredText(key)))) &&
        (value.text !== undefined || value.keys !== undefined)
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'set-agent-view':
      if (
        validIdentifier(value.source) &&
        optionalText(value.label) &&
        (value.filter === undefined || validAgentViewFilter(value.filter)) &&
        (value.sort === undefined || validAgentViewSort(value.sort))
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'clear-agent-view':
      if (value.source === undefined || validIdentifier(value.source)) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'install-integration':
    case 'uninstall-integration':
      if (
        typeof value.target === 'string' &&
        INTEGRATION_TARGETS.includes(value.target as (typeof INTEGRATION_TARGETS)[number])
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'reload-server-config':
    case 'stop-server':
    case 'reload-agent-manifests':
      return { type: value.type };
    case 'live-handoff-server':
      if (
        (value.importExe === undefined || requiredText(value.importExe)) &&
        (value.expectedProtocol === undefined || positiveInteger(value.expectedProtocol)) &&
        (value.expectedVersion === undefined || requiredText(value.expectedVersion))
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'invoke-plugin-action':
      if (
        validIdentifier(value.actionId) &&
        (value.pluginId === undefined || validIdentifier(value.pluginId)) &&
        (value.context === undefined || validPluginInvocationContext(value.context))
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'open-plugin-pane':
      if (
        validIdentifier(value.pluginId) &&
        validIdentifier(value.entrypoint) &&
        (value.placement === undefined ||
          value.placement === 'overlay' ||
          value.placement === 'popup' ||
          value.placement === 'split' ||
          value.placement === 'tab' ||
          value.placement === 'zoomed') &&
        (value.workspaceId === undefined ||
          (typeof value.workspaceId === 'string' && WORKSPACE_ID.test(value.workspaceId))) &&
        (value.targetPaneId === undefined ||
          (typeof value.targetPaneId === 'string' && PANE_ID.test(value.targetPaneId))) &&
        (value.direction === undefined || validSplitDirection(value.direction)) &&
        (value.width === undefined || validPopupSize(value.width)) &&
        (value.height === undefined || validPopupSize(value.height)) &&
        optionalText(value.cwd) &&
        optionalBoolean(value.focus) &&
        (value.env === undefined || validStringMap(value.env))
      ) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'focus-plugin-pane':
    case 'close-plugin-pane':
      if (typeof value.paneId === 'string' && PANE_ID.test(value.paneId)) {
        return value as unknown as HerdrCommand;
      }
      break;
    case 'enable-plugin':
    case 'disable-plugin':
      if (validIdentifier(value.pluginId)) {
        return value as unknown as HerdrCommand;
      }
      break;
  }

  throw new Error('Invalid Herdr command.');
}

export function parseHerdrQuery(value: unknown): HerdrQuery {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('Invalid Herdr query.');
  }
  switch (value.type) {
    case 'read-pane-output':
      if (
        typeof value.paneId === 'string' &&
        PANE_ID.test(value.paneId) &&
        (value.lines === undefined || (positiveInteger(value.lines) && value.lines <= 10_000)) &&
        (value.ansi === undefined || typeof value.ansi === 'boolean') &&
        (value.source === undefined || value.source === 'visible')
      ) {
        return {
          type: value.type,
          paneId: value.paneId,
          ...(value.lines === undefined ? {} : { lines: value.lines }),
          ...(value.ansi === undefined ? {} : { ansi: value.ansi }),
          ...(value.source === undefined ? {} : { source: value.source }),
        };
      }
      break;
    case 'list-worktrees':
      if (
        (value.workspaceId === undefined ||
          (typeof value.workspaceId === 'string' && WORKSPACE_ID.test(value.workspaceId))) &&
        optionalText(value.cwd)
      ) {
        return {
          type: value.type,
          ...(value.workspaceId === undefined ? {} : { workspaceId: value.workspaceId }),
          ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
        };
      }
      break;
    case 'get-agent-manifests':
      return { type: value.type };
    case 'list-plugins':
    case 'list-plugin-actions':
      if (value.pluginId === undefined || validIdentifier(value.pluginId)) {
        return {
          type: value.type,
          ...(value.pluginId === undefined ? {} : { pluginId: value.pluginId }),
        };
      }
      break;
  }
  throw new Error('Invalid Herdr query.');
}

export function parseConversationReadRequest(value: unknown): ConversationReadRequest {
  if (
    isRecord(value) &&
    typeof value.target === 'string' &&
    value.target.length > 0 &&
    value.target.length <= MAX_TEXT_LENGTH &&
    (value.cursor === undefined || validOpaque(value.cursor)) &&
    (value.direction === undefined ||
      value.direction === 'newest' ||
      value.direction === 'older' ||
      value.direction === 'newer') &&
    (value.limit === undefined || (positiveInteger(value.limit) && value.limit <= 256))
  ) {
    return {
      target: value.target,
      ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
      ...(value.direction === undefined ? {} : { direction: value.direction }),
      ...(value.limit === undefined ? {} : { limit: value.limit }),
    };
  }
  throw new Error('Invalid conversation read request.');
}

export function parseConversationPromptRequest(value: unknown): ConversationPromptRequest {
  if (
    !isRecord(value) ||
    typeof value.target !== 'string' ||
    value.target.length === 0 ||
    value.target.length > MAX_TEXT_LENGTH ||
    typeof value.text !== 'string' ||
    value.text.length > MAX_TERMINAL_INPUT_LENGTH ||
    (value.text.length === 0 && value.attachments === undefined)
  ) {
    throw new Error('Invalid conversation prompt request.');
  }
  if (value.attachments === undefined) {
    return { target: value.target, text: value.text };
  }
  if (
    !Array.isArray(value.attachments) ||
    value.attachments.length > MAX_CHAT_IMAGE_ATTACHMENTS ||
    !value.attachments.every((attachment) => isRecord(attachment) && validOpaque(attachment.handle))
  ) {
    throw new Error('Invalid conversation prompt request.');
  }
  return {
    target: value.target,
    text: value.text,
    attachments: value.attachments as ConversationPromptRequest['attachments'],
  };
}

export function parseConversationRespondRequest(value: unknown): ConversationRespondRequest {
  if (
    isRecord(value) &&
    typeof value.target === 'string' &&
    value.target.length > 0 &&
    value.target.length <= MAX_TEXT_LENGTH &&
    validOpaque(value.reader_generation) &&
    isRecord(value.session) &&
    validOpaque(value.session.id) &&
    validOpaque(value.request_id) &&
    validOpaque(value.decision_id)
  ) {
    return {
      target: value.target,
      reader_generation: value.reader_generation,
      session: { id: value.session.id },
      request_id: value.request_id,
      decision_id: value.decision_id,
    };
  }
  throw new Error('Invalid conversation response request.');
}

// Attachment upload bounds mirror the engine's attachment store:
// 8 KiB chunks, 25 MiB per file, and short allowlisted metadata fields.
const MAX_ATTACHMENT_MEDIA_TYPE_LENGTH = 128;
const MAX_ATTACHMENT_NAME_LENGTH = 255;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_CHUNK_BYTES = 8 * 1024;
const MAX_ATTACHMENT_CHUNK_BASE64_LENGTH = Math.ceil(MAX_ATTACHMENT_CHUNK_BYTES / 3) * 4;
const MAX_ATTACHMENT_CHUNK_INDEX = 4_096;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function parseConversationAttachmentBeginRequest(
  value: unknown,
): ConversationAttachmentBeginRequest {
  if (
    !isRecord(value) ||
    typeof value.target !== 'string' ||
    value.target.length === 0 ||
    value.target.length > MAX_TEXT_LENGTH ||
    typeof value.media_type !== 'string' ||
    value.media_type.length === 0 ||
    value.media_type.length > MAX_ATTACHMENT_MEDIA_TYPE_LENGTH ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > MAX_ATTACHMENT_NAME_LENGTH ||
    typeof value.byte_size !== 'number' ||
    !Number.isSafeInteger(value.byte_size) ||
    value.byte_size <= 0 ||
    value.byte_size > MAX_ATTACHMENT_BYTES ||
    typeof value.sha256_digest !== 'string' ||
    !SHA256_HEX.test(value.sha256_digest)
  ) {
    throw new Error('Invalid attachment begin request.');
  }
  return {
    target: value.target,
    media_type: value.media_type,
    name: value.name,
    byte_size: value.byte_size,
    sha256_digest: value.sha256_digest,
  };
}

export function parseConversationAttachmentChunkRequest(
  value: unknown,
): ConversationAttachmentChunkRequest {
  if (
    !isRecord(value) ||
    !validOpaque(value.upload) ||
    typeof value.index !== 'number' ||
    !Number.isSafeInteger(value.index) ||
    value.index < 0 ||
    value.index > MAX_ATTACHMENT_CHUNK_INDEX ||
    typeof value.data_base64 !== 'string' ||
    value.data_base64.length === 0 ||
    value.data_base64.length > MAX_ATTACHMENT_CHUNK_BASE64_LENGTH ||
    !isCanonicalBase64(value.data_base64)
  ) {
    throw new Error('Invalid attachment chunk request.');
  }
  return {
    upload: value.upload as string,
    index: value.index,
    data_base64: value.data_base64,
  };
}

export function parseConversationAttachmentFinishRequest(
  value: unknown,
): ConversationAttachmentFinishRequest {
  if (!isRecord(value) || !validOpaque(value.upload)) {
    throw new Error('Invalid attachment finish request.');
  }
  return { upload: value.upload as string };
}

export function parseConversationAttachmentAbortRequest(
  value: unknown,
): ConversationAttachmentAbortRequest {
  if (!isRecord(value) || !validOpaque(value.upload)) {
    throw new Error('Invalid attachment abort request.');
  }
  return { upload: value.upload as string };
}

export function parseTerminalOpen(value: unknown): TerminalOpenRequest {
  if (!isRecord(value) || typeof value.paneId !== 'string' || !PANE_ID.test(value.paneId)) {
    throw new Error('Invalid terminal pane identifier.');
  }
  if (!validDimension(value.cols) || !validDimension(value.rows)) {
    throw new Error('Invalid terminal dimensions.');
  }
  return { paneId: value.paneId, cols: value.cols, rows: value.rows };
}

export function parsePaneId(value: unknown): string {
  if (typeof value === 'string' && PANE_ID.test(value)) {
    return value;
  }
  throw new Error('Invalid pane identifier.');
}

export function parseTerminalResize(value: unknown): TerminalResizeRequest {
  if (
    !isRecord(value) ||
    typeof value.paneId !== 'string' ||
    !PANE_ID.test(value.paneId) ||
    !validDimension(value.cols) ||
    !validDimension(value.rows)
  ) {
    throw new Error('Invalid terminal resize.');
  }

  const cellWidthPx = value.cellWidthPx;
  const cellHeightPx = value.cellHeightPx;
  if (
    (cellWidthPx !== undefined && !validDimension(cellWidthPx)) ||
    (cellHeightPx !== undefined && !validDimension(cellHeightPx))
  ) {
    throw new Error('Invalid terminal resize.');
  }

  return {
    paneId: value.paneId,
    cols: value.cols,
    rows: value.rows,
    ...(cellWidthPx === undefined ? {} : { cellWidthPx }),
    ...(cellHeightPx === undefined ? {} : { cellHeightPx }),
  };
}

export function parseTerminalInput(value: unknown): TerminalInputRequest {
  if (
    isRecord(value) &&
    typeof value.paneId === 'string' &&
    PANE_ID.test(value.paneId) &&
    typeof value.text === 'string' &&
    value.text.length <= MAX_TERMINAL_INPUT_LENGTH
  ) {
    return { paneId: value.paneId, text: value.text };
  }
  throw new Error('Invalid terminal input.');
}

export function parseTerminalScroll(value: unknown): TerminalScrollRequest {
  if (
    isRecord(value) &&
    typeof value.paneId === 'string' &&
    PANE_ID.test(value.paneId) &&
    (value.direction === 'up' || value.direction === 'down') &&
    positiveInteger(value.lines) &&
    value.lines <= 65_535 &&
    (value.source === undefined || value.source === 'wheel' || value.source === 'page_key') &&
    (value.column === undefined || nonNegativeInteger(value.column)) &&
    (value.row === undefined || nonNegativeInteger(value.row)) &&
    (value.modifiers === undefined || nonNegativeInteger(value.modifiers))
  ) {
    return value as unknown as TerminalScrollRequest;
  }
  throw new Error('Invalid terminal scroll.');
}

export function parseRemoteEngineTarget(value: unknown): RemoteEngineTarget {
  if (
    !isRecord(value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.host !== 'string' ||
    typeof value.port !== 'number' ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > MAX_REMOTE_ENGINE_PORT
  ) {
    throw new Error('Invalid remote engine target.');
  }
  return {
    enabled: value.enabled,
    host: value.host,
    port: value.port,
  };
}
