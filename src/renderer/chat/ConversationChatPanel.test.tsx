import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConversationChatPanel,
  LOAD_OLDER_COALESCE_MS,
  pruneConversationChatState,
} from '@/renderer/chat/ConversationChatPanel';
import type { ConversationItem, ConversationReadResult } from '@/shared/conversation';
import type { PaneInfo } from '@/shared/herdr';

function pane(paneId: string, overrides: Partial<PaneInfo> = {}): PaneInfo {
  return {
    pane_id: paneId,
    display_agent: 'Codex',
    agent: 'codex',
    agent_status: 'idle',
    conversation_capability: { availability: 'supported', reason: 'ready' },
    ...overrides,
  } as PaneInfo;
}

function item(sequence: number): ConversationItem {
  return {
    id: `item-${sequence}`,
    sequence,
    provider: 'codex',
    session_id: 'session-1',
    turn_id: `turn-${sequence}`,
    type: 'assistant_message',
    phase: 'final',
    text: `answer ${sequence}`,
    state: 'completed',
  };
}

function page(
  items: ConversationItem[],
  nextCursor: string,
  previousCursor?: string,
): ConversationReadResult {
  return {
    type: 'page',
    page: {
      provider: 'codex',
      session: { id: 'session-1' },
      capability: { availability: 'supported', reason: 'ready' },
      items,
      next_cursor: nextCursor,
      previous_cursor: previousCursor,
      has_older: previousCursor !== undefined,
      revision: items.at(-1)?.sequence ?? 0,
      reader_generation: 'generation-1',
    },
  };
}
function pageEnd(items: ConversationItem[]): ConversationReadResult {
  const result = page(items, 'terminal');
  if (result.type !== 'page') {
    return result;
  }
  return {
    type: 'page',
    page: {
      ...result.page,
      next_cursor: undefined,
      previous_cursor: undefined,
      has_older: false,
    },
  };
}

beforeEach(() => {
  pruneConversationChatState([]);
});

describe('ConversationChatPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('drains every newer page after one conversation-change event', async () => {
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValueOnce(page([item(1)], 'cursor-1'))
      .mockResolvedValueOnce(page([item(2)], 'cursor-2'))
      .mockResolvedValueOnce(page([item(3)], 'cursor-2'));
    let onEvent: ((event: { event: string; data: Record<string, unknown> }) => void) | undefined;
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
      },
      onSessionEvent: vi.fn((callback) => {
        onEvent = callback;
        return () => undefined;
      }),
    } as unknown as Window['herdr'];

    render(<ConversationChatPanel pane={pane('w1:p1')} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    act(() => {
      onEvent?.({
        event: 'agent.conversation_changed',
        data: {
          pane_id: 'w1:p1',
          workspace_id: 'w1',
          session: { id: 'session-1' },
          reader_generation: 'generation-1',
          revision: 2,
          reset_required: false,
        },
      });
    });

    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(read).toHaveBeenNthCalledWith(2, {
      target: 'w1:p1',
      direction: 'newer',
      limit: 256,
      cursor: 'cursor-1',
    });
    expect(read).toHaveBeenNthCalledWith(3, {
      target: 'w1:p1',
      direction: 'newer',
      limit: 256,
      cursor: 'cursor-2',
    });
    expect(screen.getByText('answer 1')).toBeInTheDocument();
    expect(screen.getByText('answer 2')).toBeInTheDocument();
    expect(screen.getByText('answer 3')).toBeInTheDocument();
  });
  it('advances queued live reads before React commits their pages', async () => {
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValueOnce(page([item(1)], 'cursor-1'))
      .mockResolvedValueOnce(page([], 'cursor-2'))
      .mockResolvedValueOnce(page([], 'cursor-3'));
    let onEvent: ((event: { event: string; data: Record<string, unknown> }) => void) | undefined;
    window.herdr = {
      conversation: {
        read,
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
      },
      onSessionEvent: vi.fn((callback) => {
        onEvent = callback;
        return () => undefined;
      }),
    } as unknown as Window['herdr'];
    render(<ConversationChatPanel pane={pane('w1:p1')} />);
    await screen.findByText('answer 1');
    await act(async () => {
      for (const revision of [2, 3]) {
        onEvent?.({
          event: 'agent.conversation_changed',
          data: {
            pane_id: 'w1:p1',
            workspace_id: 'w1',
            session: { id: 'session-1' },
            reader_generation: 'generation-1',
            revision,
            reset_required: false,
          },
        });
      }
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenNthCalledWith(3, expect.objectContaining({ cursor: 'cursor-2' }));
  });

  it('retries a failed newer drain even when metadata revision is unchanged', async () => {
    vi.useFakeTimers();
    try {
      const started: ConversationItem = {
        id: 'started',
        sequence: 1,
        provider: 'codex',
        session_id: 'session-1',
        turn_id: 'turn-1',
        type: 'turn_state',
        state: 'started',
      };
      const plan: ConversationItem = {
        id: 'plan',
        sequence: 2,
        provider: 'codex',
        session_id: 'session-1',
        turn_id: 'turn-1',
        type: 'plan_update',
        steps: [{ label: 'Retry the missing TODO', status: 'active' }],
      };
      const read = vi
        .fn<Window['herdr']['conversation']['read']>()
        .mockResolvedValueOnce(page([started], 'cursor-1'))
        .mockResolvedValueOnce(page([plan], 'cursor-2'))
        .mockRejectedValueOnce(new Error('temporary read failure'))
        .mockResolvedValueOnce(pageEnd([plan]));
      const metadata = vi
        .fn<NonNullable<Window['herdr']['conversation']['metadata']>>()
        .mockResolvedValue(page([plan], 'metadata'));
      let onEvent: ((event: { event: string; data: Record<string, unknown> }) => void) | undefined;
      window.herdr = {
        conversation: {
          read,
          metadata,
          prompt: vi.fn(),
          respond: vi.fn(),
          subscribe: vi.fn(async () => undefined),
          unsubscribe: vi.fn(async () => undefined),
        },
        onSessionEvent: vi.fn((callback) => {
          onEvent = callback;
          return () => undefined;
        }),
      } as unknown as Window['herdr'];

      render(<ConversationChatPanel pane={pane('w1:p1')} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      act(() => {
        onEvent?.({
          event: 'agent.conversation_changed',
          data: {
            pane_id: 'w1:p1',
            workspace_id: 'w1',
            session: { id: 'session-1' },
            reader_generation: 'generation-1',
            revision: 2,
            reset_required: false,
          },
        });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(read).toHaveBeenCalledTimes(3);

      await act(async () => {
        vi.advanceTimersByTime(1_500);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(metadata).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenNthCalledWith(4, {
        target: 'w1:p1',
        direction: 'newer',
        limit: 256,
        cursor: 'cursor-2',
      });
      expect(screen.getByText('Retry the missing TODO')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  it('retains a newer retry marker when another event arrives mid-drain', async () => {
    vi.useFakeTimers();
    try {
      let finishSecondDrain: ((result: ConversationReadResult) => void) | undefined;
      const read = vi
        .fn<Window['herdr']['conversation']['read']>()
        .mockResolvedValueOnce(page([item(1)], 'cursor-1'))
        .mockResolvedValueOnce(page([item(2)], 'cursor-2'))
        .mockImplementationOnce(
          () =>
            new Promise<ConversationReadResult>((resolve) => {
              finishSecondDrain = resolve;
            }),
        )
        .mockRejectedValueOnce(new Error('second event read failed'))
        .mockResolvedValueOnce(pageEnd([item(4)]));
      const metadata = vi
        .fn<NonNullable<Window['herdr']['conversation']['metadata']>>()
        .mockResolvedValue(page([item(3)], 'metadata'));
      let onEvent: ((event: { event: string; data: Record<string, unknown> }) => void) | undefined;
      window.herdr = {
        conversation: {
          read,
          metadata,
          prompt: vi.fn(),
          respond: vi.fn(),
          subscribe: vi.fn(async () => undefined),
          unsubscribe: vi.fn(async () => undefined),
        },
        onSessionEvent: vi.fn((callback) => {
          onEvent = callback;
          return () => undefined;
        }),
      } as unknown as Window['herdr'];

      render(<ConversationChatPanel pane={pane('w1:p1')} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      act(() => {
        onEvent?.({
          event: 'agent.conversation_changed',
          data: {
            pane_id: 'w1:p1',
            workspace_id: 'w1',
            session: { id: 'session-1' },
            reader_generation: 'generation-1',
            revision: 2,
            reset_required: false,
          },
        });
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(read).toHaveBeenCalledTimes(3);

      act(() => {
        onEvent?.({
          event: 'agent.conversation_changed',
          data: {
            pane_id: 'w1:p1',
            workspace_id: 'w1',
            session: { id: 'session-1' },
            reader_generation: 'generation-1',
            revision: 4,
            reset_required: false,
          },
        });
        finishSecondDrain?.(page([item(3)], 'cursor-2'));
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(read).toHaveBeenCalledTimes(4);

      await act(async () => {
        vi.advanceTimersByTime(1_500);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(metadata).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenNthCalledWith(5, {
        target: 'w1:p1',
        direction: 'newer',
        limit: 256,
        cursor: 'cursor-2',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues draining after the first 64 newer pages', async () => {
    const responses = [page([item(1)], 'cursor-1')];
    for (let sequence = 2; sequence <= 66; sequence += 1) {
      const cursor = sequence === 66 ? 'cursor-65' : `cursor-${sequence}`;
      responses.push(page([item(sequence)], cursor));
    }
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockImplementation(async () => responses.shift() ?? page([], 'cursor-65'));
    let onEvent: ((event: { event: string; data: Record<string, unknown> }) => void) | undefined;
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
      },
      onSessionEvent: vi.fn((callback) => {
        onEvent = callback;
        return () => undefined;
      }),
    } as unknown as Window['herdr'];

    render(<ConversationChatPanel pane={pane('w1:p1')} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    act(() => {
      onEvent?.({
        event: 'agent.conversation_changed',
        data: {
          pane_id: 'w1:p1',
          workspace_id: 'w1',
          session: { id: 'session-1' },
          reader_generation: 'generation-1',
          revision: 2,
          reset_required: false,
        },
      });
    });

    await waitFor(() => expect(read).toHaveBeenCalledTimes(66));
    expect(screen.getByText('answer 66')).toBeInTheDocument();
  });

  it('does not apply a response from a pane that was replaced while reading', async () => {
    const resolvers: Array<(result: ConversationReadResult) => void> = [];
    const read = vi.fn<Window['herdr']['conversation']['read']>(
      async () =>
        new Promise<ConversationReadResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    const view = render(<ConversationChatPanel pane={pane('w1:p1')} />);
    await waitFor(() =>
      expect(read).toHaveBeenCalledWith({
        target: 'w1:p1',
        direction: 'newest',
        limit: 256,
      }),
    );
    view.rerender(<ConversationChatPanel pane={pane('w1:p2')} />);
    resolvers[0]?.(page([item(1)], 'cursor-old'));
    await waitFor(() =>
      expect(read).toHaveBeenCalledWith({
        target: 'w1:p2',
        direction: 'newest',
        limit: 256,
      }),
    );
    resolvers[1]?.(page([item(2)], 'cursor-new'));

    await waitFor(() => expect(screen.getByText('answer 2')).toBeInTheDocument());
    expect(screen.queryByText('answer 1')).not.toBeInTheDocument();
  });

  it('accepts a pasted image and uploads it with the prompt', async () => {
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValue(page([], 'cursor-1'));
    const prompt = vi.fn(async () => ({}));
    const begin = vi.fn(async () => ({ upload: { handle: 'upload-1' }, chunk_size: 8192 }));
    const chunk = vi.fn(async () => undefined);
    const finish = vi.fn(async () => ({ handle: 'staged-1' }));
    const abort = vi.fn(async () => undefined);
    window.herdr = {
      conversation: {
        read,
        prompt,
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        attachment: { begin, chunk, finish, abort },
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    render(<ConversationChatPanel pane={pane('w1:p1')} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    const image = new File(['image-bytes'], 'portrait.png', { type: 'image/png' });
    const textarea = screen.getByRole('textbox', { name: 'Chat prompt' });
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        files: [image],
      },
    });

    expect(await screen.findByText('portrait.png')).toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: 'look at this' } });
    fireEvent.submit(
      screen.getByRole('textbox', { name: 'Chat prompt' }).closest('form') as HTMLFormElement,
    );

    await waitFor(() => expect(begin).toHaveBeenCalled());
    await waitFor(() => expect(finish).toHaveBeenCalled());
    expect(chunk).toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledWith({
      target: 'w1:p1',
      text: 'look at this',
      attachments: [{ handle: 'staged-1' }],
    });
    expect(abort).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('portrait.png')).not.toBeInTheDocument());
    expect(screen.getByRole('img', { name: 'Attached image: portrait.png' })).toHaveClass(
      'size-16',
      'object-cover',
    );
  });

  it('aborts an in-flight upload when a chunk fails', async () => {
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValue(page([], 'cursor-1'));
    const prompt = vi.fn(async () => ({}));
    const begin = vi.fn(async () => ({ upload: { handle: 'upload-1' }, chunk_size: 8192 }));
    const chunk = vi.fn(async () => {
      throw new Error('chunk rejected');
    });
    const abort = vi.fn(async () => undefined);
    window.herdr = {
      conversation: {
        read,
        prompt,
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        attachment: { begin, chunk, finish: vi.fn(), abort },
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    render(<ConversationChatPanel pane={pane('w1:p-broken')} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    const image = new File(['image-bytes'], 'broken.png', { type: 'image/png' });
    fireEvent.paste(screen.getByRole('textbox', { name: 'Chat prompt' }), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        files: [image],
      },
    });
    fireEvent.submit(
      screen.getByRole('textbox', { name: 'Chat prompt' }).closest('form') as HTMLFormElement,
    );

    await waitFor(() => expect(abort).toHaveBeenCalledWith({ upload: 'upload-1' }));
    expect(prompt).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Chat prompt' })).toBeInTheDocument();
  });

  it('preserves draft text and pasted images while navigating between panes', async () => {
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValue(page([], 'cursor-1'));
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        attachment: {
          begin: vi.fn(),
          chunk: vi.fn(),
          finish: vi.fn(),
          abort: vi.fn(),
        },
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    const firstPane = pane('w-draft:p1');
    const secondPane = pane('w-draft:p2');
    const view = render(<ConversationChatPanel pane={firstPane} />);
    const input = await screen.findByRole('textbox', { name: 'Chat prompt' });
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    const image = new File(['image-bytes'], 'keep-me.png', { type: 'image/png' });
    fireEvent.paste(input, {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        files: [image],
      },
    });
    expect(await screen.findByText('keep-me.png')).toBeInTheDocument();

    view.rerender(<ConversationChatPanel pane={secondPane} />);
    expect(await screen.findByRole('textbox', { name: 'Chat prompt' })).toHaveValue('');
    expect(screen.queryByText('keep-me.png')).not.toBeInTheDocument();

    view.rerender(<ConversationChatPanel pane={firstPane} />);
    expect(await screen.findByRole('textbox', { name: 'Chat prompt' })).toHaveValue(
      'Keep this draft',
    );
    expect(screen.getByText('keep-me.png')).toBeInTheDocument();
  });
  it('shows the cached timeline immediately while a remounted session refreshes', async () => {
    let finishRefresh: ((result: ConversationReadResult) => void) | undefined;
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValueOnce(page([item(1)], 'cursor-1'))
      .mockImplementationOnce(
        () =>
          new Promise<ConversationReadResult>((resolve) => {
            finishRefresh = resolve;
          }),
      );
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];
    const sessionPane = pane('w-large:p1', {
      conversation_session: { id: 'session-1' },
    });

    const first = render(<ConversationChatPanel pane={sessionPane} />);
    expect(await screen.findByText('answer 1')).toBeInTheDocument();
    first.unmount();

    const second = render(<ConversationChatPanel pane={sessionPane} />);
    expect(screen.getByText('answer 1')).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(read).toHaveBeenNthCalledWith(2, {
      target: 'w-large:p1',
      direction: 'newer',
      limit: 256,
      cursor: 'cursor-1',
    });

    act(() => finishRefresh?.(page([item(2)], 'cursor-2')));
    expect(await screen.findByText('answer 2')).toBeInTheDocument();
    second.unmount();

    const replacement = render(
      <ConversationChatPanel
        pane={pane('w-large:p1', { conversation_session: { id: 'session-2' } })}
      />,
    );
    expect(screen.queryByText('answer 1')).not.toBeInTheDocument();
    expect(screen.queryByText('answer 2')).not.toBeInTheDocument();
    replacement.unmount();
  });
  it('does not rescan history after remounting a cached TODO boundary', async () => {
    const started: ConversationItem = {
      id: 'cached-started',
      sequence: 1,
      provider: 'codex',
      session_id: 'session-1',
      turn_id: 'turn-1',
      type: 'turn_state',
      state: 'started',
    };
    const plan: ConversationItem = {
      id: 'cached-plan',
      sequence: 2,
      provider: 'codex',
      session_id: 'session-1',
      turn_id: 'turn-1',
      type: 'plan_update',
      steps: [{ label: 'Keep cached TODO visible', status: 'active' }],
    };
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValueOnce(page([started, plan], 'live-1', 'old-1'))
      .mockResolvedValueOnce(page([started], 'live-1', 'old-2'));
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];
    const sessionPane = pane('w-cache:p1', {
      conversation_session: { id: 'session-1' },
    });

    const first = render(<ConversationChatPanel pane={sessionPane} />);
    expect(await screen.findByText('Keep cached TODO visible')).toBeInTheDocument();
    first.unmount();

    const second = render(<ConversationChatPanel pane={sessionPane} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(read).toHaveBeenNthCalledWith(2, {
      target: 'w-cache:p1',
      direction: 'newer',
      limit: 256,
      cursor: 'live-1',
    });
    expect(read).not.toHaveBeenCalledWith(expect.objectContaining({ direction: 'older' }));
    expect(screen.getByText('Keep cached TODO visible')).toBeInTheDocument();
    second.unmount();
  });
});

describe('ConversationChatPanel onboarding', () => {
  it.each(['no_session', 'transcript_missing'] as const)(
    'discovers the first transcript while the pane snapshot still says %s',
    async (reason) => {
      vi.useFakeTimers();
      try {
        const read = vi
          .fn<Window['herdr']['conversation']['read']>()
          .mockResolvedValue(pageEnd([item(1)]));
        const metadata = vi
          .fn<NonNullable<Window['herdr']['conversation']['metadata']>>()
          .mockRejectedValueOnce(new Error('transcript not created yet'))
          .mockResolvedValue(pageEnd([item(1)]));
        window.herdr = {
          conversation: {
            read,
            metadata,
            prompt: vi.fn(),
            subscribe: vi.fn(async () => undefined),
            unsubscribe: vi.fn(async () => undefined),
          },
          onSessionEvent: vi.fn(() => () => undefined),
        } as unknown as Window['herdr'];
        const initialPane = pane('w1:p1', {
          conversation_capability: { availability: 'unavailable', reason },
        });
        render(<ConversationChatPanel pane={initialPane} />);
        await act(async () => {
          await Promise.resolve();
        });
        expect(metadata).toHaveBeenCalledTimes(1);
        expect(read).not.toHaveBeenCalled();
        expect(
          screen.getByText(
            'No conversation transcript yet. Your first prompt will start the conversation.',
          ),
        ).toBeInTheDocument();
        await act(async () => {
          vi.advanceTimersByTime(1_500);
          await Promise.resolve();
        });
        expect(screen.getByText('answer 1')).toBeInTheDocument();
        expect(read).toHaveBeenCalledTimes(1);
        expect(
          screen.queryByText(
            'No conversation transcript yet. Your first prompt will start the conversation.',
          ),
        ).not.toBeInTheDocument();
        await act(async () => {
          vi.advanceTimersByTime(1_500);
          await Promise.resolve();
        });
        expect(read).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(['rerender', 'remount'] as const)(
    'does not reuse discovered capability after the native agent session changes on %s',
    async (transition) => {
      const read = vi
        .fn<Window['herdr']['conversation']['read']>()
        .mockResolvedValue(pageEnd([item(1)]));
      const metadata = vi
        .fn<NonNullable<Window['herdr']['conversation']['metadata']>>()
        .mockResolvedValueOnce(pageEnd([item(1)]))
        .mockRejectedValue(new Error('new session has no transcript yet'));
      window.herdr = {
        conversation: {
          read,
          metadata,
          subscribe: vi.fn(async () => undefined),
          unsubscribe: vi.fn(async () => undefined),
        },
        onSessionEvent: vi.fn(() => () => undefined),
      } as unknown as Window['herdr'];
      const initialPane = pane('w1:p1', {
        conversation_capability: { availability: 'unavailable', reason: 'transcript_missing' },
        agent_session: {
          agent: 'codex',
          source: 'herdr:codex',
          kind: 'session_id',
          value: 'old-session',
        },
      });
      const view = render(<ConversationChatPanel pane={initialPane} />);
      expect(await screen.findByText('answer 1')).toBeInTheDocument();
      expect(
        screen.queryByText(
          'No conversation transcript yet. Your first prompt will start the conversation.',
        ),
      ).not.toBeInTheDocument();
      const replacement = (
        <ConversationChatPanel
          pane={{
            ...initialPane,
            agent_session: {
              agent: 'codex',
              source: 'herdr:codex',
              kind: 'session_id',
              value: 'new-session',
            },
          }}
        />
      );
      if (transition === 'remount') {
        view.unmount();
        render(replacement);
      } else {
        view.rerender(replacement);
      }
      await waitFor(() => expect(metadata).toHaveBeenCalledTimes(2));
      expect(
        screen.getByText(
          'No conversation transcript yet. Your first prompt will start the conversation.',
        ),
      ).toBeInTheDocument();
      expect(read).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('answer 1')).not.toBeInTheDocument();
    },
  );

  it('probes missing transcripts only when visible and never probes unsupported providers', async () => {
    vi.useFakeTimers();
    try {
      const read = vi
        .fn<Window['herdr']['conversation']['read']>()
        .mockResolvedValue(pageEnd([item(1)]));
      const metadata = vi
        .fn<NonNullable<Window['herdr']['conversation']['metadata']>>()
        .mockResolvedValue(pageEnd([item(1)]));
      window.herdr = {
        conversation: {
          read,
          metadata,
          subscribe: vi.fn(async () => undefined),
          unsubscribe: vi.fn(async () => undefined),
        },
        onSessionEvent: vi.fn(() => () => undefined),
      } as unknown as Window['herdr'];
      const initialPane = pane('w1:p1', {
        conversation_capability: { availability: 'unavailable', reason: 'transcript_missing' },
      });
      const view = render(<ConversationChatPanel pane={initialPane} visible={false} />);
      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await Promise.resolve();
      });
      expect(metadata).not.toHaveBeenCalled();
      view.rerender(<ConversationChatPanel pane={initialPane} visible />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText('answer 1')).toBeInTheDocument();
      expect(metadata).toHaveBeenCalledTimes(1);
      view.rerender(
        <ConversationChatPanel
          pane={pane('w1:p1', {
            conversation_capability: { availability: 'unsupported', reason: 'adapter_missing' },
          })}
        />,
      );
      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await Promise.resolve();
      });
      expect(metadata).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Structured Chat is unavailable for this pane.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a provider welcome and sends the first prompt before a session exists', async () => {
    const read = vi.fn<Window['herdr']['conversation']['read']>();
    const prompt = vi.fn(async () => ({}));
    window.herdr = {
      conversation: {
        read,
        prompt,
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        attachment: {
          begin: vi.fn(),
          chunk: vi.fn(),
          finish: vi.fn(),
          abort: vi.fn(),
        },
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    render(
      <ConversationChatPanel
        pane={pane('w1:p1', {
          agent: 'claude',
          display_agent: 'Claude Code',
          cwd: '/code/new-workspace',
          conversation_capability: { availability: 'unavailable', reason: 'no_session' },
        })}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Claude Code' })).toBeInTheDocument();
    expect(
      within(document.querySelector('[data-slot="provider-welcome"]') as HTMLElement).getByText(
        '/code/new-workspace',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Provider default')).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat prompt' }), {
      target: { value: 'Start from Chat' },
    });
    fireEvent.submit(
      screen.getByRole('textbox', { name: 'Chat prompt' }).closest('form') as HTMLFormElement,
    );

    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith({
        target: 'w1:p1',
        text: 'Start from Chat',
      }),
    );
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    [true, false, 'Agent is starting. Chat will be ready when launch completes.'],
    [false, false, 'The agent is not ready for prompts. Open Terminal to finish startup.'],
  ])(
    'blocks first prompts until startup is ready (%s, %s)',
    async (launchPending, interactiveReady, message) => {
      const prompt = vi.fn(async () => ({}));
      window.herdr = {
        conversation: {
          read: vi.fn(),
          prompt,
          subscribe: vi.fn(async () => undefined),
          unsubscribe: vi.fn(async () => undefined),
        },
        onSessionEvent: vi.fn(() => () => undefined),
      } as unknown as Window['herdr'];
      const initialPane = pane('w1:p1', {
        conversation_capability: { availability: 'unavailable', reason: 'no_session' },
      });
      const openTerminal = vi.fn();
      const view = render(
        <ConversationChatPanel
          pane={initialPane}
          agentReadiness={{ launch_pending: launchPending, interactive_ready: interactiveReady }}
          onOpenTerminal={openTerminal}
        />,
      );
      const input = screen.getByRole('textbox', { name: 'Chat prompt' });
      expect(input).toBeDisabled();
      expect(screen.getByText(message)).toBeInTheDocument();
      fireEvent.change(input, { target: { value: 'first prompt' } });
      fireEvent.submit(input.closest('form') as HTMLFormElement);
      expect(prompt).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Open Terminal' }));
      expect(openTerminal).toHaveBeenCalledOnce();

      view.rerender(
        <ConversationChatPanel
          pane={initialPane}
          agentReadiness={{ launch_pending: false, interactive_ready: true }}
        />,
      );
      expect(input).toBeEnabled();
      fireEvent.submit(input.closest('form') as HTMLFormElement);
      await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
      expect(await screen.findByText('Sent · transcript unavailable')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    },
  );

  it('keeps a ready first prompt usable while explaining the missing transcript', async () => {
    const prompt = vi.fn(async () => ({}));
    window.herdr = {
      conversation: {
        read: vi.fn(),
        prompt,
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];
    render(
      <ConversationChatPanel
        pane={pane('w1:p1', {
          conversation_capability: { availability: 'unavailable', reason: 'transcript_missing' },
        })}
        agentReadiness={{ launch_pending: false, interactive_ready: true }}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Chat prompt' });
    expect(input).toBeEnabled();
    expect(
      screen.getByText(
        'No conversation transcript yet. Your first prompt will start the conversation.',
      ),
    ).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'create transcript' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Sent · transcript unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Prompt sent, but no conversation transcript is available yet. Open Terminal to check the agent.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    ['claude', 'Claude Code'],
    ['codex', 'Codex'],
    ['pi', 'Pi'],
    ['omp', 'Oh My Pi'],
  ])('uses the shared Herdr welcome for %s', async (agent, label) => {
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValue(page([], 'cursor-1'));
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        attachment: {
          begin: vi.fn(),
          chunk: vi.fn(),
          finish: vi.fn(),
          abort: vi.fn(),
        },
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    render(
      <ConversationChatPanel
        pane={pane('w1:p1', {
          agent,
          display_agent: label,
          cwd: `/code/${agent}`,
        })}
      />,
    );

    expect(await screen.findByRole('img', { name: 'Drover' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(
      within(document.querySelector('[data-slot="provider-welcome"]') as HTMLElement).getByText(
        `/code/${agent}`,
      ),
    ).toBeInTheDocument();
  });

  it('hides Claude local commands and uses their selected model in the welcome', async () => {
    const read = vi.fn<Window['herdr']['conversation']['read']>().mockResolvedValue(
      page(
        [
          {
            id: 'model-command',
            sequence: 1,
            provider: 'claude',
            session_id: 'session-1',
            turn_id: 'command-1',
            type: 'user_message',
            text: '<command-name>/model</command-name>\\n<command-message>model</command-message>',
          },
          {
            id: 'model-result',
            sequence: 2,
            provider: 'claude',
            session_id: 'session-1',
            turn_id: 'command-2',
            type: 'user_message',
            text: '<local-command-stdout>Set model to \u001b[1mFable 5\u001b[22m and saved as your default for new sessions</local-command-stdout>',
          },
        ],
        'cursor-1',
      ),
    );
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        attachment: {
          begin: vi.fn(),
          chunk: vi.fn(),
          finish: vi.fn(),
          abort: vi.fn(),
        },
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    render(
      <ConversationChatPanel
        pane={pane('w1:p1', {
          agent: 'claude',
          display_agent: 'Claude Code',
          cwd: '/code/claude-project',
        })}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByText('Fable 5')).toBeInTheDocument();
    expect(
      within(document.querySelector('[data-slot="provider-welcome"]') as HTMLElement).getByText(
        '/code/claude-project',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/command-name/)).not.toBeInTheDocument();
    expect(screen.queryByText(/local-command-stdout/)).not.toBeInTheDocument();
  });
});

describe('ConversationChatPanel live state', () => {
  it('deduplicates rapid clicks of "Load older history" to one in-flight read', async () => {
    let finishOlder: ((page: ConversationReadResult) => void) | undefined;
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValueOnce(page([item(1)], 'newer-1', 'old-1'))
      .mockImplementationOnce(
        () =>
          new Promise<ConversationReadResult>((resolve) => {
            finishOlder = resolve;
          }),
      )
      .mockImplementationOnce(() => Promise.resolve(page([item(0)], 'newer-1', 'old-2')));
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    render(<ConversationChatPanel pane={pane('w-older:p1')} />);
    const button = await screen.findByRole('button', { name: 'Load older history' });
    expect(button).toBeEnabled();

    // Burst of rapid clicks while the older read is still pending.
    for (let click = 0; click < 20; click += 1) {
      fireEvent.click(button);
    }

    // Only the single in-flight older read is enqueued.
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(read).toHaveBeenNthCalledWith(2, {
      target: 'w-older:p1',
      direction: 'older',
      limit: 256,
      cursor: 'old-1',
    });

    // Button is disabled and shows the loading affordance while pending.
    const loadingButton = await screen.findByRole('button', {
      name: 'Loading older history…',
    });
    expect(loadingButton).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Load older history' })).not.toBeInTheDocument();

    // Resolve the older page; the button re-enables with the normal label.
    act(() => finishOlder?.(page([item(0)], 'newer-1', 'old-2')));
    const reenabled = await screen.findByRole('button', { name: 'Load older history' });
    expect(reenabled).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Loading older history…' }),
    ).not.toBeInTheDocument();

    // A subsequent single click still works and uses the updated older cursor.
    fireEvent.click(reenabled);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(read).toHaveBeenNthCalledWith(3, {
      target: 'w-older:p1',
      direction: 'older',
      limit: 256,
      cursor: 'old-2',
    });
  });

  it('coalesces a trailing burst of "Load older history" clicks into one follow-up read', async () => {
    vi.useFakeTimers();
    try {
      let finishOlder: ((result: ConversationReadResult) => void) | undefined;
      const read = vi
        .fn<Window['herdr']['conversation']['read']>()
        .mockResolvedValueOnce(page([item(1)], 'newer-1', 'old-1'))
        .mockImplementationOnce(
          () =>
            new Promise<ConversationReadResult>((resolve) => {
              finishOlder = resolve;
            }),
        )
        .mockImplementationOnce(() => Promise.resolve(page([item(0)], 'newer-1', 'old-2')));
      window.herdr = {
        conversation: {
          read,
          prompt: vi.fn(),
          respond: vi.fn(),
          subscribe: vi.fn(async () => undefined),
          unsubscribe: vi.fn(async () => undefined),
        },
        onSessionEvent: vi.fn(() => () => undefined),
      } as unknown as Window['herdr'];

      render(<ConversationChatPanel pane={pane('w-older:p2')} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      const button = screen.getByRole('button', { name: 'Load older history' });
      expect(button).toBeEnabled();

      // A single synchronous burst of clicks: the first starts the in-flight
      // older read and every later click is folded into a pending coalesced
      // follow-up rather than issuing one read per click.
      act(() => {
        for (let click = 0; click < 30; click += 1) {
          fireEvent.click(button);
        }
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      // 30 clicks -> only the in-flight older read is enqueued (mount was call 1).
      expect(read).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenNthCalledWith(2, {
        target: 'w-older:p2',
        direction: 'older',
        limit: 256,
        cursor: 'old-1',
      });

      // The button stays in the disabled/loading state while the read settles.
      expect(screen.getByRole('button', { name: 'Loading older history…' })).toBeDisabled();

      // Resolve the in-flight page. The trailing coalesce window opens; when it
      // elapses exactly ONE follow-up read is issued, not thirty.
      act(() => finishOlder?.(page([item(0)], 'newer-1', 'old-2')));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(LOAD_OLDER_COALESCE_MS);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(read).toHaveBeenCalledTimes(3);
      expect(read).toHaveBeenNthCalledWith(3, {
        target: 'w-older:p2',
        direction: 'older',
        limit: 256,
        cursor: 'old-2',
      });

      // The follow-up read settles and nothing else fires; the button re-enables.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(LOAD_OLDER_COALESCE_MS);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(read).toHaveBeenCalledTimes(3);
      const reenabled = screen.getByRole('button', { name: 'Load older history' });
      expect(reenabled).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a prominent working indicator for an in-progress turn', async () => {
    const read = vi.fn<Window['herdr']['conversation']['read']>().mockResolvedValue(
      page(
        [
          {
            id: 'turn-1',
            sequence: 1,
            provider: 'pi',
            session_id: 'session-1',
            turn_id: 'turn-1',
            type: 'turn_state',
            state: 'started',
            started_ms: Date.now() - 5_000,
          },
        ],
        'cursor-1',
      ),
    );
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        attachment: {
          begin: vi.fn(),
          chunk: vi.fn(),
          finish: vi.fn(),
          abort: vi.fn(),
        },
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    render(<ConversationChatPanel pane={pane('w1:p1')} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Working');
    expect(screen.getByText(/for \d+S/)).toBeInTheDocument();
  });
  it('keeps polling a readable conversation when pane status is stale', async () => {
    vi.useFakeTimers();
    try {
      const started: ConversationItem = {
        id: 'turn-started',
        sequence: 1,
        provider: 'codex',
        session_id: 'session-1',
        turn_id: 'turn-1',
        type: 'turn_state',
        state: 'started',
        started_ms: Date.now(),
      };
      const plan: ConversationItem = {
        id: 'plan-after-poll',
        sequence: 2,
        provider: 'codex',
        session_id: 'session-1',
        turn_id: 'turn-1',
        type: 'plan_update',
        steps: [
          { label: 'Plan arrives after event drop', status: 'active' },
          { label: 'Keep polling while working', status: 'pending' },
        ],
      };
      const read = vi
        .fn<Window['herdr']['conversation']['read']>()
        .mockResolvedValueOnce(page([started], 'cursor-1', undefined))
        .mockResolvedValue(page([plan], 'cursor-1'));
      window.herdr = {
        conversation: {
          read,
          prompt: vi.fn(),
          respond: vi.fn(),
          subscribe: vi.fn(async () => undefined),
          unsubscribe: vi.fn(async () => undefined),
          attachment: {
            begin: vi.fn(),
            chunk: vi.fn(),
            finish: vi.fn(),
            abort: vi.fn(),
          },
        },
        onSessionEvent: vi.fn(() => () => undefined),
      } as unknown as Window['herdr'];

      render(<ConversationChatPanel pane={pane('w1:p1')} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(1_500);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(read).toHaveBeenNthCalledWith(2, {
        target: 'w1:p1',
        direction: 'newer',
        limit: 256,
        cursor: 'cursor-1',
      });
      expect(screen.getByText('Plan arrives after event drop')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  it('uses visible metadata polling before fetching changed conversation items', async () => {
    vi.useFakeTimers();
    try {
      const started: ConversationItem = {
        id: 'turn-started',
        sequence: 1,
        provider: 'codex',
        session_id: 'session-1',
        turn_id: 'turn-1',
        type: 'turn_state',
        state: 'started',
        started_ms: Date.now(),
      };
      const plan: ConversationItem = {
        id: 'plan-after-metadata',
        sequence: 2,
        provider: 'codex',
        session_id: 'session-1',
        turn_id: 'turn-1',
        type: 'plan_update',
        steps: [{ label: 'Refresh from metadata', status: 'active' }],
      };
      const read = vi
        .fn<Window['herdr']['conversation']['read']>()
        .mockResolvedValueOnce(page([started], 'cursor-1', undefined))
        .mockResolvedValue(page([plan], 'cursor-2', undefined));
      const metadata = vi
        .fn<NonNullable<Window['herdr']['conversation']['metadata']>>()
        .mockResolvedValueOnce(page([started], 'metadata-1', undefined))
        .mockResolvedValue(page([plan], 'metadata-2', undefined));
      window.herdr = {
        conversation: {
          read,
          metadata,
          prompt: vi.fn(),
          respond: vi.fn(),
          subscribe: vi.fn(async () => undefined),
          unsubscribe: vi.fn(async () => undefined),
          attachment: {
            begin: vi.fn(),
            chunk: vi.fn(),
            finish: vi.fn(),
            abort: vi.fn(),
          },
        },
        onSessionEvent: vi.fn(() => () => undefined),
      } as unknown as Window['herdr'];

      const view = render(<ConversationChatPanel pane={pane('w1:p1')} visible={false} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(1_500);
        await Promise.resolve();
      });
      expect(metadata).not.toHaveBeenCalled();

      view.rerender(<ConversationChatPanel pane={pane('w1:p1')} visible />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(metadata).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(1_500);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(read).toHaveBeenNthCalledWith(2, {
        target: 'w1:p1',
        direction: 'newer',
        limit: 256,
        cursor: 'cursor-1',
      });
      expect(screen.getByText('Refresh from metadata')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['claude', 'Claude Code'],
    ['codex', 'Codex'],
    ['pi', 'Pi'],
    ['omp', 'Oh My Pi'],
  ])('shows pane-status work for %s before a started turn is readable', async (agent, label) => {
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValue(page([item(1)], 'cursor-1'));
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        attachment: {
          begin: vi.fn(),
          chunk: vi.fn(),
          finish: vi.fn(),
          abort: vi.fn(),
        },
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    render(
      <ConversationChatPanel
        pane={pane('w1:p1', {
          agent,
          display_agent: label,
          agent_status: 'working',
        })}
      />,
    );

    expect(await screen.findByRole('status')).toHaveTextContent('Working');
  });

  it('stops showing work after an interrupted turn settles', async () => {
    const read = vi.fn<Window['herdr']['conversation']['read']>().mockResolvedValue(
      page(
        [
          {
            id: 'turn-started',
            sequence: 1,
            provider: 'pi',
            session_id: 'session-1',
            turn_id: 'turn-1',
            type: 'turn_state',
            state: 'started',
            started_ms: Date.now() - 5_000,
          },
          {
            id: 'turn-interrupted',
            sequence: 2,
            provider: 'pi',
            session_id: 'session-1',
            turn_id: 'turn-1',
            type: 'turn_state',
            state: 'interrupted',
          },
        ],
        'cursor-1',
      ),
    );
    window.herdr = {
      conversation: {
        read,
        prompt: vi.fn(),
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        attachment: {
          begin: vi.fn(),
          chunk: vi.fn(),
          finish: vi.fn(),
          abort: vi.fn(),
        },
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    render(<ConversationChatPanel pane={pane('w1:p1')} />);
    await screen.findByText('Stopped');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('sends the prompt when Enter is pressed and keeps Shift+Enter for newlines', async () => {
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValue(page([], 'cursor-1'));
    const prompt = vi.fn(async () => ({}));
    window.herdr = {
      conversation: {
        read,
        prompt,
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        attachment: {
          begin: vi.fn(),
          chunk: vi.fn(),
          finish: vi.fn(),
          abort: vi.fn(),
        },
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    render(<ConversationChatPanel pane={pane('w1:p1')} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const textarea = screen.getByRole('textbox', { name: 'Chat prompt' });
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(prompt).toHaveBeenCalledWith({ target: 'w1:p1', text: 'hello' }));
    expect(textarea).toHaveValue('');
  });

  it('shows a queued echo immediately and resolves it once the durable message arrives', async () => {
    let resolveDurable: ((value: ConversationReadResult) => void) | undefined;
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValueOnce(page([], 'cursor-1'))
      .mockImplementationOnce(
        () =>
          new Promise<ConversationReadResult>((resolve) => {
            resolveDurable = resolve;
          }),
      );
    const durablePage = () =>
      page(
        [
          {
            id: 'durable-1',
            sequence: 2,
            provider: 'pi',
            session_id: 'session-1',
            turn_id: 'turn-1',
            type: 'user_message',
            text: 'hello',
            attachments: [],
          },
        ],
        'cursor-1',
      );
    const prompt = vi.fn(async () => ({}));
    window.herdr = {
      conversation: {
        read,
        prompt,
        respond: vi.fn(),
        subscribe: vi.fn(async () => undefined),
        unsubscribe: vi.fn(async () => undefined),
        attachment: {
          begin: vi.fn(),
          chunk: vi.fn(),
          finish: vi.fn(),
          abort: vi.fn(),
        },
      },
      onSessionEvent: vi.fn(() => () => undefined),
    } as unknown as Window['herdr'];

    render(<ConversationChatPanel pane={pane('w1:p1')} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const textarea = screen.getByRole('textbox', { name: 'Chat prompt' });
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // The echo appears instantly as queued.
    expect(await screen.findByText('Queued')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();

    // Once the durable page with the same user text arrives, the echo is
    // replaced by the durable item and the Queued badge disappears.
    act(() => resolveDurable?.(durablePage()));
    await waitFor(() => expect(screen.queryByText('Queued')).not.toBeInTheDocument());
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
