export { decodeConversationChangedEvent } from '@/shared/conversation';

import type {
  ConversationCapability,
  ConversationChangedEvent,
  ConversationItem,
  ConversationPage,
  ConversationPageDirection,
  ConversationReadResult,
  ConversationSessionIdentity,
} from '@/shared/conversation';

export interface PendingAttachment {
  readonly media_type: string;
  readonly name: string;
  readonly preview_url: string;
}

export interface PendingMessage {
  readonly id: string;
  readonly text: string;
  readonly status: 'queued' | 'syncing' | 'failed';
  readonly attachments?: readonly PendingAttachment[];
}

export interface ConversationStore {
  readonly paneId: string;
  readonly provider?: string;
  readonly session?: ConversationSessionIdentity;
  readonly readerGeneration?: string;
  readonly capability?: ConversationCapability;
  readonly items: readonly ConversationItem[];
  /** Optimistic user messages not yet visible in the durable transcript. */
  readonly pending: readonly PendingMessage[];
  readonly revision: number;
  readonly olderCursor?: string;
  readonly newerCursor?: string;
  readonly resetRequired: boolean;
  readonly changed: boolean;
}

export function createConversationStore(paneId: string): ConversationStore {
  return {
    paneId,
    items: [],
    pending: [],
    revision: 0,
    resetRequired: false,
    changed: false,
  };
}

function sortItems(items: Iterable<ConversationItem>): ConversationItem[] {
  return [...items].sort(
    (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
  );
}
function compareBySequence(left: ConversationItem, right: ConversationItem): number {
  return left.sequence - right.sequence || left.id.localeCompare(right.id);
}
/**
 * Merge an incoming page into the existing (already sequence-sorted) item list
 * without re-sorting the whole collection and without recreating unchanged item
 * objects. ConversationItem.sequence is monotonically increasing within a
 * conversation, so older/newer pages are contiguous prepends/appends and
 * refreshed pages only update already-present ids in place.
 *
 * Unchanged items keep their exact object identity (so memoized Turn rendering
 * does not re-run), while brand-new items are inserted at their sorted position
 * with a linear two-pointer merge. If an incoming item reuses an existing id but
 * with a different sequence (not expected), fall back to the previous full sort.
 */
function mergePageIntoItems(
  existing: readonly ConversationItem[],
  incoming: readonly ConversationItem[],
): ConversationItem[] {
  if (incoming.length === 0) {
    return [...existing];
  }
  if (existing.length === 0) {
    return sortItems(incoming);
  }
  const existingById = new Map<string, ConversationItem>();
  for (const item of existing) {
    existingById.set(item.id, item);
  }
  for (const item of incoming) {
    const previous = existingById.get(item.id);
    if (previous !== undefined && previous.sequence !== item.sequence) {
      return sortItems([...existing, ...incoming]);
    }
  }
  const incomingById = new Map<string, ConversationItem>();
  for (const item of incoming) {
    incomingById.set(item.id, item);
  }
  const replaced = existing.map((item) => incomingById.get(item.id) ?? item);
  const brandNew = incoming.filter((item) => !existingById.has(item.id)).sort(compareBySequence);
  if (brandNew.length === 0) {
    return replaced;
  }
  const merged: ConversationItem[] = [];
  let index = 0;
  for (const item of brandNew) {
    while (index < replaced.length && compareBySequence(replaced[index], item) <= 0) {
      merged.push(replaced[index]);
      index += 1;
    }
    merged.push(item);
  }
  for (; index < replaced.length; index += 1) {
    merged.push(replaced[index]);
  }
  return merged;
}
function sameCapability(
  left: ConversationCapability | undefined,
  right: ConversationCapability,
): boolean {
  return (
    left?.availability === right.availability &&
    left.reason === right.reason &&
    left.message === right.message
  );
}

function withAttachmentPreviews(
  item: ConversationItem,
  pendingAttachments: readonly PendingAttachment[] | undefined,
  previous: ConversationItem | undefined,
): ConversationItem {
  if (item.type !== 'user_message' || !item.attachments?.length) {
    return item;
  }
  const previousAttachments = previous?.type === 'user_message' ? previous.attachments : undefined;
  const attachments = item.attachments.map((attachment, index) => {
    const previewUrl =
      pendingAttachments?.[index]?.preview_url ?? previousAttachments?.[index]?.preview_url;
    return previewUrl === undefined ? attachment : { ...attachment, preview_url: previewUrl };
  });
  return { ...item, attachments };
}

function replacePage(
  store: ConversationStore,
  page: ConversationPage,
  direction: ConversationPageDirection,
): ConversationStore {
  const sameReader =
    store.readerGeneration === undefined || store.readerGeneration === page.reader_generation;
  const canMergeExisting = sameReader && !store.resetRequired;
  // Optimistic echoes resolve once the durable transcript contains the same
  // user text (the engine's prompt submission queues before persisting).
  const pending = [...store.pending];
  const pendingAttachmentsByItemId = new Map<string, readonly PendingAttachment[]>();
  for (const item of page.items) {
    if (item.type !== 'user_message') {
      continue;
    }
    const match = pending.findIndex((candidate) => candidate.text === item.text);
    if (match >= 0) {
      const [matched] = pending.splice(match, 1);
      if (matched.attachments?.length) {
        pendingAttachmentsByItemId.set(item.id, matched.attachments);
      }
    }
  }
  let olderCursor = canMergeExisting ? store.olderCursor : undefined;
  let newerCursor = canMergeExisting ? store.newerCursor : undefined;
  if (direction === 'newest') {
    olderCursor =
      canMergeExisting && store.items.length > 0 ? store.olderCursor : page.previous_cursor;
    newerCursor = page.next_cursor;
  } else if (direction === 'older') {
    olderCursor = page.previous_cursor;
  } else {
    newerCursor = page.next_cursor;
  }
  if (
    canMergeExisting &&
    page.items.length === 0 &&
    store.provider === page.provider &&
    store.session?.id === page.session.id &&
    store.readerGeneration === page.reader_generation &&
    sameCapability(store.capability, page.capability) &&
    store.revision >= page.revision &&
    store.olderCursor === olderCursor &&
    store.newerCursor === newerCursor
  ) {
    return store;
  }
  const byId = new Map<string, ConversationItem>(
    canMergeExisting ? store.items.map((item) => [item.id, item]) : [],
  );
  const incoming = page.items.map((item) =>
    withAttachmentPreviews(item, pendingAttachmentsByItemId.get(item.id), byId.get(item.id)),
  );
  return {
    ...store,
    provider: page.provider,
    session: page.session,
    readerGeneration: page.reader_generation,
    capability: page.capability,
    items: mergePageIntoItems(canMergeExisting ? store.items : [], incoming),
    pending: canMergeExisting ? pending : store.pending,
    revision: canMergeExisting ? Math.max(store.revision, page.revision) : page.revision,
    olderCursor,
    newerCursor,
    resetRequired: false,
    changed: true,
  };
}

export function applyConversationRead(
  store: ConversationStore,
  result: ConversationReadResult,
  direction: ConversationPageDirection = 'newest',
): ConversationStore {
  if (result.type === 'reset_required') {
    return {
      ...store,
      session: result.session,
      readerGeneration: result.reader_generation,
      // Keep the last complete timeline visible while the replacement page
      // is fetched; the banner marks it stale instead of blanking the chat.
      items: store.items,
      pending: [],
      olderCursor: undefined,
      newerCursor: undefined,
      resetRequired: true,
      changed: true,
    };
  }
  return replacePage(store, result.page, direction);
}

export function applyConversationChanged(
  store: ConversationStore,
  event: ConversationChangedEvent,
): ConversationStore {
  if (event.pane_id !== store.paneId) {
    return store;
  }
  if (
    event.reset_required ||
    (store.readerGeneration !== undefined && store.readerGeneration !== event.reader_generation)
  ) {
    return {
      ...store,
      session: event.session,
      readerGeneration: event.reader_generation,
      items: store.items,
      pending: [],
      olderCursor: undefined,
      newerCursor: undefined,
      resetRequired: true,
      changed: true,
    };
  }
  return {
    ...store,
    session: event.session,
    readerGeneration: event.reader_generation,
    revision: Math.max(store.revision, event.revision),
    changed: true,
  };
}

export function consumeChanged(store: ConversationStore): ConversationStore {
  return store.changed ? { ...store, changed: false } : store;
}

export function conversationItems(store: ConversationStore): ConversationItem[] {
  return [...store.items];
}
