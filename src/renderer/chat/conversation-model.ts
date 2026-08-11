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

export interface PendingMessage {
  readonly id: string;
  readonly text: string;
  readonly status: 'queued' | 'syncing' | 'failed';
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

function replacePage(
  store: ConversationStore,
  page: ConversationPage,
  direction: ConversationPageDirection,
): ConversationStore {
  const sameReader =
    store.readerGeneration === undefined || store.readerGeneration === page.reader_generation;
  const byId = new Map<string, ConversationItem>(
    sameReader ? store.items.map((item) => [item.id, item]) : [],
  );
  for (const item of page.items) {
    byId.set(item.id, item);
  }
  // Optimistic echoes resolve once the durable transcript contains the same
  // user text (the engine's prompt submission queues before persisting).
  const pending = [...store.pending];
  for (const item of page.items) {
    if (item.type !== 'user_message') {
      continue;
    }
    const match = pending.findIndex((candidate) => candidate.text === item.text);
    if (match >= 0) {
      pending.splice(match, 1);
    }
  }
  let olderCursor = sameReader ? store.olderCursor : undefined;
  let newerCursor = sameReader ? store.newerCursor : undefined;
  if (direction === 'newest') {
    olderCursor = page.previous_cursor;
    newerCursor = page.next_cursor;
  } else if (direction === 'older') {
    olderCursor = page.previous_cursor;
  } else {
    newerCursor = page.next_cursor;
  }
  return {
    ...store,
    provider: page.provider,
    session: page.session,
    readerGeneration: page.reader_generation,
    capability: page.capability,
    items: sortItems(byId.values()),
    pending: sameReader ? pending : store.pending,
    revision: sameReader ? Math.max(store.revision, page.revision) : page.revision,
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
