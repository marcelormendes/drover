import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConversationChatPanel,
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

function page(items: ConversationItem[], nextCursor: string): ConversationReadResult {
  return {
    type: 'page',
    page: {
      provider: 'codex',
      session: { id: 'session-1' },
      capability: { availability: 'supported', reason: 'ready' },
      items,
      next_cursor: nextCursor,
      previous_cursor: 'older-1',
      has_older: true,
      revision: items.at(-1)?.sequence ?? 0,
      reader_generation: 'generation-1',
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
      cursor: 'cursor-1',
    });
    expect(read).toHaveBeenNthCalledWith(3, {
      target: 'w1:p1',
      direction: 'newer',
      cursor: 'cursor-2',
    });
    expect(screen.getByText('answer 1')).toBeInTheDocument();
    expect(screen.getByText('answer 2')).toBeInTheDocument();
    expect(screen.getByText('answer 3')).toBeInTheDocument();
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
      expect(read).toHaveBeenCalledWith({ target: 'w1:p1', direction: 'newest' }),
    );
    view.rerender(<ConversationChatPanel pane={pane('w1:p2')} />);
    resolvers[0]?.(page([item(1)], 'cursor-old'));
    await waitFor(() =>
      expect(read).toHaveBeenCalledWith({ target: 'w1:p2', direction: 'newest' }),
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
});

describe('ConversationChatPanel onboarding', () => {
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
    expect(screen.getByText('/code/new-workspace')).toBeInTheDocument();
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

    expect(await screen.findByLabelText('Drover')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByText(`/code/${agent}`)).toBeInTheDocument();
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
    expect(screen.getByText('/code/claude-project')).toBeInTheDocument();
    expect(screen.queryByText(/command-name/)).not.toBeInTheDocument();
    expect(screen.queryByText(/local-command-stdout/)).not.toBeInTheDocument();
  });
});

describe('ConversationChatPanel live state', () => {
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
    expect(screen.getByText(/for \d+s/)).toBeInTheDocument();
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
