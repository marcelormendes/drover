import { describe, expect, it } from 'vitest';
import {
  applyConversationChanged,
  applyConversationRead,
  consumeChanged,
  createConversationStore,
} from '@/renderer/chat/conversation-model';
import type { ConversationItem, ConversationReadResult } from '@/shared/conversation';

function item(
  sequence: number,
  id = `item-${sequence}`,
  text = `answer ${sequence}`,
): ConversationItem {
  return {
    id,
    sequence,
    provider: 'codex',
    session_id: 'session',
    turn_id: 'turn',
    type: 'assistant_message',
    phase: 'final',
    text,
    state: 'completed',
  };
}

function page(items: ConversationItem[], generation = 'reader-1', revision = items.length) {
  return {
    type: 'page' as const,
    page: {
      provider: 'codex',
      session: { id: 'session' },
      capability: { availability: 'supported' as const, reason: 'ready' as const },
      items,
      next_cursor: 'newer-cursor',
      previous_cursor: 'older-cursor',
      has_older: true,
      revision,
      reader_generation: generation,
    },
  } satisfies ConversationReadResult;
}

describe('conversation model', () => {
  it('merges pages idempotently and keeps canonical order', () => {
    let store = createConversationStore('w1:p1');
    store = applyConversationRead(store, page([item(2), item(3)]));
    store = applyConversationRead(
      store,
      page([item(1), item(2, 'item-2', 'revised')], 'reader-1', 4),
    );

    expect(store.items.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    const revised = store.items.find(({ id }) => id === 'item-2');
    expect(revised?.type === 'assistant_message' && revised.text).toBe('revised');
    expect(store.revision).toBe(4);
    expect(store.olderCursor).toBe('older-cursor');
  });
  it('preserves the store identity for an unchanged empty live-tail page', () => {
    const store = applyConversationRead(createConversationStore('w1:p1'), page([]));

    expect(applyConversationRead(store, page([]), 'newer')).toBe(store);
  });

  it('keeps unchanged replayed items and empty-page collections stable', () => {
    const store = applyConversationRead(createConversationStore('w1:p1'), page([item(1)]));
    const replayed = applyConversationRead(store, page([item(1)]));
    expect(replayed.items).toBe(store.items);
    expect(replayed.pending).toBe(store.pending);
    const empty = page([], 'reader-1', 2);
    expect(applyConversationRead(replayed, empty, 'newer').items).toBe(store.items);
    const updated = applyConversationRead(replayed, page([item(1, 'item-1', 'updated')]));
    expect(updated.items[0]).not.toBe(store.items[0]);
  });

  it('deduplicates items even if an existing id changes sequence', () => {
    const store = applyConversationRead(createConversationStore('w1:p1'), page([item(1)]));
    const updated = applyConversationRead(store, page([item(3, 'item-1'), item(2)]));
    expect(updated.items.map(({ id }) => id)).toEqual(['item-2', 'item-1']);
    const duplicate = applyConversationRead(updated, page([item(4), item(4)]));
    expect(duplicate.items.map(({ id }) => id)).toEqual(['item-2', 'item-1', 'item-4']);
  });

  it('ends history at has_older false even if the page retains a cursor', () => {
    const store = applyConversationRead(createConversationStore('w1:p1'), page([item(2)]));
    const oldest = page([item(1)]);
    const updated = applyConversationRead(
      store,
      { ...oldest, page: { ...oldest.page, has_older: false } },
      'older',
    );
    expect(updated.olderCursor).toBeUndefined();
    expect(updated.newerCursor).toBe(store.newerCursor);
  });

  it('does not merge items across different sessions with the same reader', () => {
    const store = applyConversationRead(createConversationStore('w1:p1'), page([item(2)]));
    const replacement = page([item(1)]);
    replacement.page.session.id = 'replacement';
    expect(applyConversationRead(store, replacement).items.map(({ sequence }) => sequence)).toEqual(
      [1],
    );
  });

  it('resets before applying data from a changed reader generation', () => {
    let store = applyConversationRead(createConversationStore('w1:p1'), page([item(10)]));
    store = applyConversationRead(store, page([item(1)], 'reader-2', 1));

    expect(store.items.map(({ sequence }) => sequence)).toEqual([1]);
    expect(store.revision).toBe(1);
    expect(store.resetRequired).toBe(false);
  });

  it('marks an explicit reset and accepts the next page', () => {
    let store = applyConversationRead(createConversationStore('w1:p1'), {
      type: 'reset_required',
      session: { id: 'new-session' },
      reader_generation: 'reader-2',
    });
    expect(store.resetRequired).toBe(true);
    expect(store.items).toHaveLength(0);

    store = applyConversationRead(store, page([item(1)], 'reader-2', 1));
    expect(store.resetRequired).toBe(false);
    expect(store.items).toHaveLength(1);
  });
  it('replaces retained items after a same-generation reset', () => {
    let store = applyConversationRead(
      createConversationStore('w1:p1'),
      page([item(10, 'old-item', 'stale item')], 'reader-1', 10),
    );
    store = applyConversationRead(store, {
      type: 'reset_required',
      session: { id: 'session' },
      reader_generation: 'reader-1',
    });
    store = applyConversationRead(store, page([item(1, 'new-item', 'new item')], 'reader-1', 1));

    expect(store.items.map(({ id }) => id)).toEqual(['new-item']);
    expect(store.resetRequired).toBe(false);
  });

  it('ignores conversation events for other panes and resets matching panes', () => {
    let store = applyConversationRead(createConversationStore('w1:p1'), page([item(1)]));
    const other = applyConversationChanged(store, {
      pane_id: 'w1:p2',
      workspace_id: 'w1',
      session: { id: 'session' },
      reader_generation: 'reader-1',
      revision: 2,
      reset_required: false,
    });
    expect(other).toBe(store);

    store = applyConversationChanged(store, {
      pane_id: 'w1:p1',
      workspace_id: 'w1',
      session: { id: 'session-2' },
      reader_generation: 'reader-2',
      revision: 1,
      reset_required: false,
    });
    expect(store.resetRequired).toBe(true);
    // The last complete timeline stays visible while the replacement loads.
    expect(store.items).toHaveLength(1);
  });

  it('keeps history pagination from replacing the live-tail cursor', () => {
    let store = applyConversationRead(createConversationStore('w1:p1'), page([item(10)]));
    const history = {
      ...page([item(1)], 'reader-1', 1),
      page: {
        ...page([item(1)], 'reader-1', 1).page,
        next_cursor: 'history-next',
        previous_cursor: 'history-previous',
      },
    } satisfies ConversationReadResult;
    store = applyConversationRead(store, history, 'older');
    expect(store.olderCursor).toBe('history-previous');
    expect(store.newerCursor).toBe('newer-cursor');

    const live = {
      ...page([item(11)], 'reader-1', 3),
      page: {
        ...page([item(11)], 'reader-1', 3).page,
        next_cursor: 'live-next',
        previous_cursor: 'history-previous',
      },
    } satisfies ConversationReadResult;
    store = applyConversationRead(store, live, 'newer');
    expect(store.olderCursor).toBe('history-previous');
    expect(store.newerCursor).toBe('live-next');
    expect(store.items.map(({ sequence }) => sequence)).toEqual([1, 10, 11]);
  });
  it('preserves the oldest history cursor when refreshing the newest page', () => {
    let store = applyConversationRead(createConversationStore('w1:p1'), page([item(10)]));
    const history = {
      ...page([item(1)], 'reader-1', 1),
      page: {
        ...page([item(1)], 'reader-1', 1).page,
        next_cursor: 'history-next',
        previous_cursor: 'history-oldest',
      },
    } satisfies ConversationReadResult;
    store = applyConversationRead(store, history, 'older');
    expect(store.olderCursor).toBe('history-oldest');

    const refreshedNewest = {
      ...page([item(10)], 'reader-1', 2),
      page: {
        ...page([item(10)], 'reader-1', 2).page,
        next_cursor: 'newest-live',
        previous_cursor: 'newest-older-1',
      },
    } satisfies ConversationReadResult;
    store = applyConversationRead(store, refreshedNewest, 'newest');
    expect(store.olderCursor).toBe('history-oldest');
    expect(store.newerCursor).toBe('newest-live');
  });

  it('prepending older history preserves item identity and relative order', () => {
    let store = applyConversationRead(createConversationStore('w1:p1'), page([item(2), item(3)]));
    const existingIds = store.items.map(({ id }) => id);
    const existingById = new Map(store.items.map((entry) => [entry.id, entry]));

    const older = {
      ...page([item(1), item(2, 'item-2', 'revised')], 'reader-1', 3),
      page: {
        ...page([item(1), item(2, 'item-2', 'revised')], 'reader-1', 3).page,
        next_cursor: 'history-next',
        previous_cursor: 'history-oldest',
      },
    } satisfies ConversationReadResult;
    store = applyConversationRead(store, older, 'older');

    expect(store.items.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    // Unchanged items keep their exact object identity so memoized turns do not
    // re-render after an older page is prepended.
    expect(store.items.find(({ id }) => id === 'item-3')).toBe(existingById.get('item-3'));
    // The prior relative order of retained items is unchanged.
    const relative = store.items.filter(({ id }) => existingIds.includes(id)).map(({ id }) => id);
    expect(relative).toEqual(existingIds);
    // An updated item is replaced (new identity) with the revised content.
    const revised = store.items.find(({ id }) => id === 'item-2');
    expect(revised).not.toBe(existingById.get('item-2'));
    expect(revised?.type === 'assistant_message' && revised.text).toBe('revised');
  });

  it('allows callers to clear the changed marker after batching', () => {
    const store = applyConversationRead(createConversationStore('w1:p1'), page([item(1)]));
    expect(consumeChanged(store).changed).toBe(false);
  });

  it('reconciles only one optimistic echo for each durable same-text message', () => {
    const store = {
      ...createConversationStore('w1:p1'),
      pending: [
        { id: 'pending-1', text: 'same prompt', status: 'syncing' as const },
        { id: 'pending-2', text: 'same prompt', status: 'syncing' as const },
      ],
    };
    const durable: ConversationItem = {
      id: 'user-1',
      sequence: 1,
      provider: 'codex',
      session_id: 'session',
      turn_id: 'turn',
      type: 'user_message',
      text: 'same prompt',
    };

    const next = applyConversationRead(store, page([durable]));

    expect(next.pending).toEqual([{ id: 'pending-2', text: 'same prompt', status: 'syncing' }]);
  });

  it('moves optimistic image previews onto the matching durable user message', () => {
    const store = {
      ...createConversationStore('w1:p1'),
      pending: [
        {
          id: 'pending-image',
          text: 'review image',
          status: 'syncing' as const,
          attachments: [
            {
              media_type: 'image/png',
              name: 'screenshot.png',
              preview_url: 'blob:local-preview',
            },
          ],
        },
      ],
    };
    const durable: ConversationItem = {
      id: 'user-image',
      sequence: 1,
      provider: 'omp',
      session_id: 'session',
      turn_id: 'turn',
      type: 'user_message',
      text: 'review image',
      attachments: [{ media_type: 'image/png', name: 'image', byte_size: 128 }],
    };

    const reconciled = applyConversationRead(store, page([durable]));
    const refreshed = applyConversationRead(reconciled, page([durable], 'reader-1', 2), 'newer');

    expect(reconciled.pending).toHaveLength(0);
    expect(reconciled.items[0]).toMatchObject({
      type: 'user_message',
      attachments: [{ preview_url: 'blob:local-preview' }],
    });
    expect(refreshed.items[0]).toMatchObject({
      type: 'user_message',
      attachments: [{ preview_url: 'blob:local-preview' }],
    });
  });
});
