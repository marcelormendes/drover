export { decodeConversationChangedEvent } from '@/shared/conversation';

import type {
  ApprovalDecision,
  AttachmentMetadata,
  ConversationCapability,
  ConversationItem,
  ConversationItemPayload,
  ConversationPage,
  ConversationReadResult,
  ConversationReasonCode,
  ConversationRespondReason,
  ConversationRespondResult,
  ConversationSessionIdentity,
  PlanStep,
} from '@/shared/conversation';

const MAX_ITEMS = 256;
const MAX_TEXT_LENGTH = 16_384;
const MAX_MESSAGE_LENGTH = 256 * 1024;
const MAX_OPAQUE_LENGTH = 256;
const MAX_PATHS = 64;
const MAX_ATTACHMENTS = 16;
const MAX_DECISIONS = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max = MAX_TEXT_LENGTH): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function optionalString(value: unknown, max = MAX_TEXT_LENGTH): string | undefined | null {
  return value === undefined ? undefined : boundedString(value, max);
}

function uint(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function opaque(value: unknown): string | null {
  const result = boundedString(value, MAX_OPAQUE_LENGTH);
  return result && !/[\\/]/.test(result) ? result : null;
}

function safePath(value: unknown): string | null {
  const result = boundedString(value);
  return result &&
    !result.startsWith('/') &&
    !result.startsWith('\\') &&
    !/(^|[\\/])\.\.([\\/]|$)/.test(result)
    ? result
    : null;
}

function invalid(): never {
  throw new Error('Herdr returned an invalid conversation response.');
}

function decodeSession(value: unknown): ConversationSessionIdentity {
  if (!isRecord(value)) {
    return invalid();
  }
  const id = opaque(value.id);
  return id ? { id } : invalid();
}

function decodeCapability(value: unknown): ConversationCapability {
  if (!isRecord(value)) {
    return invalid();
  }
  const availability = value.availability;
  if (
    availability !== 'supported' &&
    availability !== 'unavailable' &&
    availability !== 'unsupported'
  ) {
    return invalid();
  }
  const reasons: ConversationReasonCode[] = [
    'ready',
    'adapter_missing',
    'no_session',
    'transcript_missing',
    'transcript_invalid',
    'source_unreadable',
  ];
  if (!reasons.includes(value.reason as ConversationReasonCode)) {
    return invalid();
  }
  const message = optionalString(value.message);
  if (message === null) {
    return invalid();
  }
  return {
    availability,
    reason: value.reason as ConversationReasonCode,
    ...(message === undefined ? {} : { message }),
  };
}

function decodeAttachments(value: unknown): AttachmentMetadata[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    return invalid();
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      return invalid();
    }
    const media_type = boundedString(item.media_type, 128);
    const name = boundedString(item.name, 256);
    const byte_size = uint(item.byte_size);
    return media_type && name && byte_size !== null ? { media_type, name, byte_size } : invalid();
  });
}

function decodeSteps(value: unknown): PlanStep[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    return invalid();
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      return invalid();
    }
    const label = boundedString(item.label);
    const status = item.status;
    if (
      !label ||
      (status !== 'pending' && status !== 'active' && status !== 'completed' && status !== 'failed')
    ) {
      return invalid();
    }
    return { label, status };
  });
}

function decodeDecisions(value: unknown): ApprovalDecision[] {
  if (!Array.isArray(value) || value.length > MAX_DECISIONS) {
    return invalid();
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      return invalid();
    }
    const id = opaque(item.id);
    const label = boundedString(item.label);
    return id && label ? { id, label } : invalid();
  });
}

function decodePayload(value: Record<string, unknown>): ConversationItemPayload {
  switch (value.type) {
    case 'user_message': {
      const text =
        typeof value.text === 'string' && value.text.length <= MAX_MESSAGE_LENGTH
          ? value.text
          : null;
      const attachments = decodeAttachments(value.attachments);
      return text !== null && (text.length > 0 || attachments.length > 0)
        ? { type: value.type, text, attachments }
        : invalid();
    }
    case 'assistant_message': {
      const text = boundedString(value.text, MAX_MESSAGE_LENGTH);
      const phase = value.phase;
      const state = value.state;
      return text &&
        (phase === 'commentary' || phase === 'final') &&
        (state === 'completed' || state === 'interrupted' || state === 'failed')
        ? { type: value.type, phase, text, state }
        : invalid();
    }
    case 'plan_update':
      return { type: value.type, steps: decodeSteps(value.steps) };
    case 'tool_activity': {
      const action = boundedString(value.action);
      const label = boundedString(value.label);
      const status = value.status;
      const preview = optionalString(value.preview, MAX_TEXT_LENGTH);
      const detail = optionalString(value.detail, MAX_TEXT_LENGTH);
      const duration_ms = value.duration_ms === undefined ? undefined : uint(value.duration_ms);
      const paths = value.paths === undefined ? [] : value.paths;
      if (
        !action ||
        !label ||
        (status !== 'running' && status !== 'completed' && status !== 'failed') ||
        preview === null ||
        detail === null ||
        duration_ms === null ||
        !Array.isArray(paths) ||
        paths.length > MAX_PATHS ||
        !paths.every((path) => safePath(path))
      ) {
        return invalid();
      }
      return {
        type: value.type,
        action,
        label,
        status,
        ...(preview === undefined ? {} : { preview }),
        ...(detail === undefined ? {} : { detail }),
        ...(duration_ms === undefined ? {} : { duration_ms }),
        paths: paths as string[],
      };
    }
    case 'file_change': {
      const path = safePath(value.path);
      const change = value.change;
      const summary = optionalString(value.summary, MAX_TEXT_LENGTH);
      if (
        !path ||
        !['created', 'modified', 'deleted', 'renamed'].includes(change as string) ||
        summary === null
      ) {
        return invalid();
      }
      return {
        type: value.type,
        path,
        change: change as 'created' | 'modified' | 'deleted' | 'renamed',
        ...(summary === undefined ? {} : { summary }),
      };
    }
    case 'approval': {
      const request_id = opaque(value.request_id);
      const prompt = boundedString(value.prompt);
      const status = value.status;
      const selected_decision = optionalString(value.selected_decision, MAX_OPAQUE_LENGTH);
      if (
        !request_id ||
        !prompt ||
        (status !== 'pending' && status !== 'resolved') ||
        typeof value.structured_response !== 'boolean' ||
        selected_decision === null
      ) {
        return invalid();
      }
      return {
        type: value.type,
        request_id,
        prompt,
        decisions: decodeDecisions(value.decisions),
        status,
        ...(selected_decision === undefined ? {} : { selected_decision }),
        structured_response: value.structured_response,
      };
    }
    case 'turn_state': {
      const state = value.state;
      const started_ms = value.started_ms === undefined ? undefined : uint(value.started_ms);
      const duration_ms = value.duration_ms === undefined ? undefined : uint(value.duration_ms);
      const error = optionalString(value.error);
      if (
        !['started', 'completed', 'interrupted', 'failed'].includes(state as string) ||
        started_ms === null ||
        duration_ms === null ||
        error === null
      ) {
        return invalid();
      }
      return {
        type: value.type,
        state: state as 'started' | 'completed' | 'interrupted' | 'failed',
        ...(started_ms === undefined ? {} : { started_ms }),
        ...(duration_ms === undefined ? {} : { duration_ms }),
        ...(error === undefined ? {} : { error }),
      };
    }
    case 'notice': {
      const message = boundedString(value.message);
      return message ? { type: value.type, message } : invalid();
    }
    default:
      return invalid();
  }
}

function decodeItem(value: unknown): ConversationItem {
  if (!isRecord(value)) {
    return invalid();
  }
  const id = opaque(value.id);
  const sequence = uint(value.sequence);
  const provider = boundedString(value.provider, 64);
  const session_id = value.session_id === undefined ? undefined : opaque(value.session_id);
  const turn_id = value.turn_id === undefined ? undefined : opaque(value.turn_id);
  const timestamp_ms = value.timestamp_ms === undefined ? undefined : uint(value.timestamp_ms);
  if (
    !id ||
    sequence === null ||
    !provider ||
    session_id === null ||
    turn_id === null ||
    timestamp_ms === null
  ) {
    return invalid();
  }
  return {
    id,
    sequence,
    provider,
    ...(session_id === undefined ? {} : { session_id }),
    ...(turn_id === undefined ? {} : { turn_id }),
    ...(timestamp_ms === undefined ? {} : { timestamp_ms }),
    ...decodePayload(value),
  } as ConversationItem;
}

function decodePage(value: unknown): ConversationPage {
  if (!isRecord(value)) {
    return invalid();
  }
  const provider = boundedString(value.provider, 64);
  const reader_generation = opaque(value.reader_generation);
  const revision = uint(value.revision);
  const next_cursor = value.next_cursor === undefined ? undefined : opaque(value.next_cursor);
  const previous_cursor =
    value.previous_cursor === undefined ? undefined : opaque(value.previous_cursor);
  if (
    !provider ||
    !reader_generation ||
    revision === null ||
    next_cursor === null ||
    previous_cursor === null ||
    typeof value.has_older !== 'boolean' ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_ITEMS
  ) {
    return invalid();
  }
  return {
    provider,
    session: decodeSession(value.session),
    capability: decodeCapability(value.capability),
    items: value.items.map(decodeItem),
    ...(next_cursor === undefined ? {} : { next_cursor }),
    ...(previous_cursor === undefined ? {} : { previous_cursor }),
    has_older: value.has_older,
    revision,
    reader_generation,
  };
}

export function decodeConversationRespondResult(value: unknown): ConversationRespondResult {
  if (!isRecord(value) || value.type !== 'agent_conversation_respond' || !isRecord(value.result)) {
    return invalid();
  }
  const request_id = opaque(value.result.request_id);
  const decision_id = opaque(value.result.decision_id);
  const reasons: ConversationRespondReason[] = [
    'accepted',
    'already_resolved',
    'stale_request',
    'unknown_request',
    'conflicting_decision',
    'session_mismatch',
  ];
  if (
    !request_id ||
    !decision_id ||
    typeof value.result.accepted !== 'boolean' ||
    !reasons.includes(value.result.reason as ConversationRespondReason)
  ) {
    return invalid();
  }
  return {
    request_id,
    decision_id,
    accepted: value.result.accepted,
    reason: value.result.reason as ConversationRespondReason,
  };
}

export function decodeConversationReadResult(value: unknown): ConversationReadResult {
  if (!isRecord(value) || value.type !== 'agent_conversation_read' || !isRecord(value.read)) {
    return invalid();
  }
  if (value.read.type === 'page') {
    return { type: 'page', page: decodePage(value.read.page) };
  }
  if (value.read.type === 'reset_required') {
    if (!isRecord(value.read)) {
      return invalid();
    }
    return {
      type: 'reset_required',
      session: decodeSession(value.read.session),
      reader_generation: opaque(value.read.reader_generation) ?? invalid(),
    };
  }
  return invalid();
}

export function decodeAttachmentBeginResult(value: unknown): {
  upload: { handle: string };
  chunk_size: number;
} {
  if (
    !isRecord(value) ||
    value.type !== 'agent_attachment_begin' ||
    !isRecord(value.upload) ||
    typeof value.upload.handle !== 'string' ||
    value.upload.handle.length === 0 ||
    value.upload.handle.length > 256 ||
    !Number.isSafeInteger(value.chunk_size) ||
    (value.chunk_size as number) <= 0 ||
    (value.chunk_size as number) > 1024 * 1024
  ) {
    return invalid();
  }
  return {
    upload: { handle: value.upload.handle },
    chunk_size: value.chunk_size as number,
  };
}

export function decodeAttachmentFinishedResult(value: unknown): { handle: string } {
  if (
    !isRecord(value) ||
    value.type !== 'agent_attachment_finished' ||
    !isRecord(value.attachment) ||
    typeof value.attachment.handle !== 'string' ||
    value.attachment.handle.length === 0 ||
    value.attachment.handle.length > 256
  ) {
    return invalid();
  }
  return { handle: value.attachment.handle };
}
