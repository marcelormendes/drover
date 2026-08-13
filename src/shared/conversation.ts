export type ConversationAvailability = 'supported' | 'unavailable' | 'unsupported';

export type ConversationReasonCode =
  | 'ready'
  | 'adapter_missing'
  | 'no_session'
  | 'transcript_missing'
  | 'transcript_invalid'
  | 'source_unreadable';

export interface ConversationCapability {
  availability: ConversationAvailability;
  reason: ConversationReasonCode;
  message?: string;
}

const PRE_SESSION_REASONS: Partial<Record<ConversationReasonCode, true>> = {
  no_session: true,
  transcript_missing: true,
};

export function isPreSessionConversationCapability(
  capability: ConversationCapability | undefined,
): boolean {
  return (
    capability?.availability === 'unavailable' && PRE_SESSION_REASONS[capability.reason] === true
  );
}

export interface ConversationSessionIdentity {
  id: string;
}

export type ConversationPageDirection = 'newest' | 'older' | 'newer';

export interface ConversationReadRequest {
  target: string;
  cursor?: string;
  direction?: ConversationPageDirection;
  limit?: number;
}

export interface ConversationPage {
  provider: string;
  session: ConversationSessionIdentity;
  capability: ConversationCapability;
  items: ConversationItem[];
  next_cursor?: string;
  previous_cursor?: string;
  has_older: boolean;
  revision: number;
  reader_generation: string;
}

export type ConversationReadResult =
  | { type: 'page'; page: ConversationPage }
  | {
      type: 'reset_required';
      session: ConversationSessionIdentity;
      reader_generation: string;
    };

export interface ConversationItemBase {
  id: string;
  sequence: number;
  provider: string;
  session_id?: string;
  turn_id?: string;
  timestamp_ms?: number;
}

export interface AttachmentMetadata {
  media_type: string;
  name: string;
  byte_size: number;
  /** Renderer-local object URL for a just-sent image; never supplied by the engine. */
  preview_url?: string;
}

export type AssistantMessagePhase = 'commentary' | 'final';
export type CompletionState = 'completed' | 'interrupted' | 'failed';
export type PlanStepStatus = 'pending' | 'active' | 'completed' | 'failed';
export type ToolStatus = 'running' | 'completed' | 'failed';
export type FileChangeKind = 'created' | 'modified' | 'deleted' | 'renamed';
export type ApprovalStatus = 'pending' | 'resolved';
export type TurnStateKind = 'started' | 'completed' | 'interrupted' | 'failed';

export interface PlanStep {
  label: string;
  status: PlanStepStatus;
}

export interface ApprovalDecision {
  id: string;
  label: string;
}

export type ConversationItemPayload =
  | {
      type: 'user_message';
      text: string;
      attachments?: AttachmentMetadata[];
    }
  | {
      type: 'assistant_message';
      phase: AssistantMessagePhase;
      text: string;
      state: CompletionState;
    }
  | { type: 'plan_update'; steps: PlanStep[] }
  | {
      type: 'tool_activity';
      action: string;
      label: string;
      status: ToolStatus;
      preview?: string;
      detail?: string;
      duration_ms?: number;
      paths?: string[];
    }
  | {
      type: 'file_change';
      path: string;
      change: FileChangeKind;
      summary?: string;
    }
  | {
      type: 'approval';
      request_id: string;
      prompt: string;
      decisions: ApprovalDecision[];
      status: ApprovalStatus;
      selected_decision?: string;
      structured_response: boolean;
    }
  | {
      type: 'turn_state';
      state: TurnStateKind;
      started_ms?: number;
      duration_ms?: number;
      error?: string;
    }
  | { type: 'notice'; message: string };

export type ConversationItem = ConversationItemBase & ConversationItemPayload;

export interface ConversationRespondRequest {
  target: string;
  reader_generation: string;
  session: ConversationSessionIdentity;
  request_id: string;
  decision_id: string;
}

export type ConversationRespondReason =
  | 'accepted'
  | 'already_resolved'
  | 'stale_request'
  | 'unknown_request'
  | 'conflicting_decision'
  | 'session_mismatch';

export interface ConversationRespondResult {
  request_id: string;
  decision_id: string;
  accepted: boolean;
  reason: ConversationRespondReason;
}

export interface ConversationAttachmentHandle {
  handle: string;
}

/** Opaque handle for an in-progress attachment upload; never a host path. */
export interface ConversationAttachmentUpload {
  handle: string;
}

export interface ConversationAttachmentBeginRequest {
  target: string;
  media_type: string;
  name: string;
  byte_size: number;
  sha256_digest: string;
}

export interface ConversationAttachmentBeginResult {
  upload: ConversationAttachmentUpload;
  chunk_size: number;
}

export interface ConversationAttachmentChunkRequest {
  upload: string;
  index: number;
  data_base64: string;
}

export interface ConversationAttachmentFinishRequest {
  upload: string;
}

export interface ConversationAttachmentAbortRequest {
  upload: string;
}

/** Uploaded attachment ready to attach to a prompt. */
export interface ConversationStagedAttachment {
  handle: string;
}

export interface ConversationPromptRequest {
  target: string;
  text: string;
  attachments?: ConversationAttachmentHandle[];
}

export interface ConversationChangedEvent {
  pane_id: string;
  workspace_id: string;
  session: ConversationSessionIdentity;
  reader_generation: string;
  revision: number;
  reset_required: boolean;
}

function isConversationRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function opaqueConversationValue(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\\/]/.test(value)
    ? value
    : null;
}

function conversationRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function decodeConversationChangedEvent(value: unknown): ConversationChangedEvent | null {
  if (
    !isConversationRecord(value) ||
    !isConversationRecord(value.session) ||
    typeof value.reset_required !== 'boolean'
  ) {
    return null;
  }
  const paneId = opaqueConversationValue(value.pane_id);
  const workspaceId = opaqueConversationValue(value.workspace_id);
  const sessionId = opaqueConversationValue(value.session.id);
  const readerGeneration = opaqueConversationValue(value.reader_generation);
  const revision = conversationRevision(value.revision);
  if (!paneId || !workspaceId || !sessionId || !readerGeneration || revision === null) {
    return null;
  }
  return {
    pane_id: paneId,
    workspace_id: workspaceId,
    session: { id: sessionId },
    reader_generation: readerGeneration,
    revision,
    reset_required: value.reset_required,
  };
}
