import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConversationChatPanel,
  pruneConversationChatState,
} from '@/renderer/chat/ConversationChatPanel';
import { formatDuration } from '@/renderer/chat/ConversationTimeline';
import type { ConversationItem, ConversationReadResult } from '@/shared/conversation';
import type { PaneInfo } from '@/shared/herdr';

const pane = {
  pane_id: 'w1:p1',
  display_agent: 'Pi',
  agent: 'pi',
  conversation_capability: { availability: 'supported', reason: 'ready' },
} as PaneInfo;

function page(
  items: ConversationItem[],
  options: { previousCursor?: string; nextCursor?: string } = {},
): ConversationReadResult {
  return {
    type: 'page',
    page: {
      provider: 'pi',
      session: { id: 'session-1' },
      capability: { availability: 'supported', reason: 'ready' },
      items,
      ...(options.previousCursor ? { previous_cursor: options.previousCursor } : {}),
      ...(options.nextCursor ? { next_cursor: options.nextCursor } : {}),
      has_older: Boolean(options.previousCursor),
      revision: items.at(-1)?.sequence ?? 0,
      reader_generation: 'generation-1',
    },
  };
}

function assistant(
  sequence: number,
  phase: 'commentary' | 'final',
  text: string,
): ConversationItem {
  return {
    id: `assistant-${sequence}`,
    sequence,
    provider: 'pi',
    session_id: 'session-1',
    turn_id: 'turn-1',
    type: 'assistant_message',
    phase,
    text,
    state: 'completed',
  };
}

function tool(
  sequence: number,
  action = `tool-${sequence}`,
  detail?: string,
): Extract<ConversationItem, { type: 'tool_activity' }> {
  return {
    id: `tool-${sequence}`,
    sequence,
    provider: 'pi',
    session_id: 'session-1',
    turn_id: 'turn-1',
    type: 'tool_activity',
    action,
    label: 'completed',
    status: 'completed',
    ...(detail ? { detail } : {}),
  };
}

function setup(
  initial: ConversationReadResult,
  overrides: Partial<Window['herdr']['conversation']> = {},
) {
  const read = vi.fn<Window['herdr']['conversation']['read']>().mockResolvedValue(initial);
  const prompt = vi.fn(async () => ({}));
  const respond = vi.fn(async () => ({
    request_id: 'approval-1',
    decision_id: 'allow',
    accepted: true,
    reason: 'accepted' as const,
  }));
  let onEvent: ((event: { event: string; data: Record<string, unknown> }) => void) | undefined;
  window.herdr = {
    conversation: {
      read,
      prompt,
      respond,
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
      attachment: {
        begin: vi.fn(),
        chunk: vi.fn(),
        finish: vi.fn(),
        abort: vi.fn(),
      },
      ...overrides,
    },
    onSessionEvent: vi.fn((callback) => {
      onEvent = callback;
      return () => undefined;
    }),
  } as unknown as Window['herdr'];

  const view = render(<ConversationChatPanel pane={pane} />);
  return { read, prompt, respond, onEvent: () => onEvent, view };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  pruneConversationChatState([]);
});

describe('ConversationChatPanel turn projection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('formats live work in seconds, minutes, and hours', () => {
    expect(formatDuration(59_999)).toBe('59S');
    expect(formatDuration(60_000)).toBe('1M 0S');
    expect(formatDuration(1_303_000)).toBe('21M 43S');
    expect(formatDuration(4_830_000)).toBe('1H 20M 30S');
  });

  it('renders OMP terminal metadata below the Chat composer', async () => {
    const { view } = setup(page([]));
    view.rerender(
      <ConversationChatPanel
        pane={
          {
            ...pane,
            agent: 'omp',
            display_agent: 'Oh My Pi',
            cwd: '/home/marcelorm/workspace/herdr-desktop',
            tokens: {
              model: 'GPT-5.6-Sol',
              thinking: 'xhigh',
              cwd: '/home/marcelorm/workspace/herdr-desktop',
              git_branch: 'feature/chat',
              git_unstaged: '3',
              git_staged: '2',
              git_untracked: '1',
              context_percent: '44.8',
              context_tokens: '121856',
              context_window: '272000',
              input_tokens: '100000',
              output_tokens: '20000',
              cache_read_tokens: '1856',
              cost: '182.54',
              premium_requests: '0',
              subscription: 'true',
            },
          } as PaneInfo
        }
      />,
    );

    const metadata = document.querySelector('[data-slot="agent-metadata"]');
    expect(metadata).not.toBeNull();
    expect(metadata).toHaveTextContent('GPT-5.6-Sol · xhigh');
    expect(metadata).toHaveTextContent('~/workspace/herdr-desktop');
    expect(metadata).toHaveTextContent('feature/chat *3 +2 ?1');
    expect(metadata).toHaveTextContent('44.8%/272K');
    expect(metadata).toHaveTextContent('in 100K');
    expect(metadata).toHaveTextContent('out 20K');
    expect(metadata).toHaveTextContent('cache 1.9K');
    expect(metadata).toHaveTextContent('$182.54 (sub)');
    expect(
      screen.getByRole('textbox').compareDocumentPosition(metadata as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('pins the complete active TODO above the live working duration', async () => {
    setup(
      page([
        {
          id: 'started',
          sequence: 1,
          provider: 'pi',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'turn_state',
          state: 'started',
          started_ms: Date.now() - 3_000,
        },
        {
          id: 'plan',
          sequence: 2,
          provider: 'pi',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'plan_update',
          steps: [
            { label: 'Inspect source', status: 'completed' },
            { label: 'Write regression tests', status: 'active' },
            { label: 'Prepare release notes', status: 'pending' },
          ],
        },
      ]),
    );

    const status = await screen.findByRole('status');
    const activePlan = document.querySelector('[data-slot="active-plan"]');
    expect(activePlan).not.toBeNull();
    expect(within(activePlan as HTMLElement).getByText('TODO')).toBeInTheDocument();
    expect(within(activePlan as HTMLElement).getByText('Inspect source')).toBeInTheDocument();
    expect(
      within(activePlan as HTMLElement).getByText('Write regression tests'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Inspect source')).toHaveLength(1);
    const activeStep = within(activePlan as HTMLElement)
      .getByText('Write regression tests')
      .closest('[data-slot="plan-step"]');
    const pendingStep = within(activePlan as HTMLElement)
      .getByText('Prepare release notes')
      .closest('[data-slot="plan-step"]');
    expect(activeStep).toHaveAttribute('aria-current', 'step');
    expect(activeStep).toHaveAttribute('data-state', 'active');
    expect(activeStep).toHaveClass('todo-step-active');
    expect(activeStep?.querySelector('[data-slot="active-task-indicator"]')).not.toBeNull();
    expect(within(activeStep as HTMLElement).getByText('working')).toBeVisible();
    expect(pendingStep).toHaveAttribute('data-state', 'pending');
    expect(pendingStep).toHaveClass('todo-step-pending');
    expect(within(pendingStep as HTMLElement).getByText('queued')).toBeVisible();
    expect(
      (activePlan as HTMLElement).compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(status).toHaveTextContent(/Working for \d+S/);
  });

  it('keeps the session TODO pinned when work resumes in a new turn', async () => {
    const { view } = setup(
      page([
        {
          id: 'plan',
          sequence: 1,
          provider: 'omp',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'plan_update',
          steps: [
            { label: 'Finish interrupted work', status: 'active' },
            { label: 'Run final verification', status: 'pending' },
          ],
        },
        {
          id: 'interrupted',
          sequence: 2,
          provider: 'omp',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'turn_state',
          state: 'interrupted',
        },
        {
          id: 'resumed',
          sequence: 3,
          provider: 'omp',
          session_id: 'session-1',
          turn_id: 'turn-2',
          type: 'user_message',
          text: 'Resume.',
        },
        {
          id: 'resumed-tool',
          sequence: 4,
          provider: 'omp',
          session_id: 'session-1',
          turn_id: 'turn-2',
          type: 'tool_activity',
          action: 'bash',
          label: 'completed',
          status: 'completed',
        },
      ]),
    );
    view.rerender(
      <ConversationChatPanel pane={{ ...pane, agent_status: 'working' } as PaneInfo} />,
    );

    const status = await screen.findByRole('status');
    const activePlan = document.querySelector('[data-slot="active-plan"]');
    expect(activePlan).not.toBeNull();
    expect(within(activePlan as HTMLElement).getByText('Finish interrupted work')).toBeVisible();
    expect(within(activePlan as HTMLElement).getByText('Run final verification')).toBeVisible();
    expect(
      (activePlan as HTMLElement).compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders a TODO update from the conversation event without waiting for polling', async () => {
    const setupResult = setup(
      page(
        [
          {
            id: 'started',
            sequence: 1,
            provider: 'omp',
            session_id: 'session-1',
            turn_id: 'turn-1',
            type: 'turn_state',
            state: 'started',
            started_ms: Date.now(),
          },
        ],
        { nextCursor: 'cursor-1' },
      ),
    );
    await screen.findByRole('status');
    setupResult.read.mockResolvedValueOnce(
      page(
        [
          {
            id: 'plan',
            sequence: 2,
            provider: 'omp',
            session_id: 'session-1',
            turn_id: 'turn-1',
            type: 'plan_update',
            steps: [
              { label: 'Mirror terminal TODO', status: 'active' },
              { label: 'Verify Chat', status: 'pending' },
            ],
          },
        ],
        { nextCursor: 'cursor-2' },
      ),
    );

    act(() => {
      setupResult.onEvent()?.({
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

    expect(await screen.findByText('Mirror terminal TODO')).toBeVisible();
    expect(setupResult.read).toHaveBeenLastCalledWith({
      target: 'w1:p1',
      direction: 'newer',
      limit: 256,
      cursor: 'cursor-1',
    });

    setupResult.read.mockResolvedValueOnce(
      page(
        [
          {
            id: 'plan-clear',
            sequence: 3,
            provider: 'omp',
            session_id: 'session-1',
            turn_id: 'turn-1',
            type: 'plan_update',
            steps: [],
          },
        ],
        { nextCursor: 'cursor-3' },
      ),
    );
    act(() => {
      setupResult.onEvent()?.({
        event: 'agent.conversation_changed',
        data: {
          pane_id: 'w1:p1',
          workspace_id: 'w1',
          session: { id: 'session-1' },
          reader_generation: 'generation-1',
          revision: 3,
          reset_required: false,
        },
      });
    });

    await waitFor(() => expect(screen.queryByText('Mirror terminal TODO')).not.toBeInTheDocument());
    expect(document.querySelector('[data-slot="active-plan"]')).toBeNull();
  });
  it('requests the full conversation tail so an active TODO outside the default page remains visible', async () => {
    const started: ConversationItem = {
      id: 'started-tail',
      sequence: 1,
      provider: 'omp',
      session_id: 'session-1',
      turn_id: 'turn-1',
      type: 'turn_state',
      state: 'started',
      started_ms: Date.now(),
    };
    const plan: ConversationItem = {
      id: 'plan-tail',
      sequence: 2,
      provider: 'omp',
      session_id: 'session-1',
      turn_id: 'turn-1',
      type: 'plan_update',
      steps: [
        { label: 'Recover the active TODO', status: 'active' },
        { label: 'Keep it synchronized', status: 'pending' },
      ],
    };
    const read = vi.fn<Window['herdr']['conversation']['read']>();
    read.mockImplementation(async (request) =>
      page(request.limit === 256 ? [started, plan] : [started]),
    );

    setup(page([started]), { read });

    expect(await screen.findByText('Recover the active TODO')).toBeVisible();
    expect(read).toHaveBeenCalledWith({
      target: 'w1:p1',
      direction: 'newest',
      limit: 256,
    });
  });

  it('backfills older pages when the active TODO is outside the newest page', async () => {
    const initialItems: ConversationItem[] = [
      ...Array.from({ length: 255 }, (_, index) =>
        assistant(index + 2, 'final', `tail item ${index}`),
      ),
      {
        id: 'started-tail',
        sequence: 257,
        provider: 'pi',
        session_id: 'session-1',
        turn_id: 'turn-1',
        type: 'turn_state',
        state: 'started',
      },
    ];
    const plan: ConversationItem = {
      id: 'plan-outside-tail',
      sequence: 1,
      provider: 'pi',
      session_id: 'session-1',
      turn_id: 'turn-1',
      type: 'plan_update',
      steps: [
        { label: 'Recover an old TODO', status: 'active' },
        { label: 'Keep it visible', status: 'pending' },
      ],
    };
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockImplementation(async (request) =>
        request.direction === 'older'
          ? page([plan])
          : page(initialItems, { previousCursor: 'older-plan', nextCursor: 'newer-tail' }),
      );

    setup(page(initialItems, { previousCursor: 'older-plan', nextCursor: 'newer-tail' }), { read });

    expect((await screen.findAllByText('Recover an old TODO')).length).toBeGreaterThan(0);
    expect(read).toHaveBeenNthCalledWith(2, {
      target: 'w1:p1',
      direction: 'older',
      limit: 256,
      cursor: 'older-plan',
    });
  });
  it('refreshes the live cursor while backfilling an old TODO boundary', async () => {
    const started: ConversationItem = {
      id: 'started-long-history',
      sequence: 1,
      provider: 'pi',
      session_id: 'session-1',
      turn_id: 'turn-1',
      type: 'turn_state',
      state: 'started',
    };
    const plan: ConversationItem = {
      id: 'plan-after-long-history',
      sequence: 65,
      provider: 'pi',
      session_id: 'session-1',
      turn_id: 'turn-1',
      type: 'plan_update',
      steps: [{ label: 'Recover TODO beyond sixty-four pages', status: 'active' }],
    };
    let olderCalls = 0;
    let newestCalls = 0;
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockImplementation(async (request) => {
        if (request.direction !== 'older') {
          newestCalls += 1;
          return page([started], {
            previousCursor: newestCalls === 1 ? 'history-0' : 'history-refresh',
            nextCursor: newestCalls === 1 ? 'live-0' : 'live-refresh',
          });
        }
        olderCalls += 1;
        return olderCalls === 65
          ? page([plan])
          : page([], { previousCursor: `history-${olderCalls}` });
      });

    setup(page([started], { previousCursor: 'history-0', nextCursor: 'live-0' }), { read });

    expect(await screen.findByText('Recover TODO beyond sixty-four pages')).toBeVisible();
    expect(olderCalls).toBe(65);
    expect(newestCalls).toBeGreaterThan(1);
  });
  it('hydrates an active TODO when only a running tool is in the newest page', async () => {
    const runningTool: ConversationItem = {
      id: 'running-tool-tail',
      sequence: 256,
      provider: 'pi',
      session_id: 'session-1',
      turn_id: 'turn-1',
      type: 'tool_activity',
      action: 'long-running-command',
      label: 'running',
      status: 'running',
    };
    const initialItems = [
      ...Array.from({ length: 255 }, (_, index) =>
        assistant(index + 1, 'final', `history item ${index}`),
      ),
      runningTool,
    ];
    const plan: ConversationItem = {
      id: 'plan-running-tool',
      sequence: 1,
      provider: 'pi',
      session_id: 'session-1',
      turn_id: 'turn-1',
      type: 'plan_update',
      steps: [{ label: 'Recover TODO from running tool', status: 'active' }],
    };
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockImplementation(async (request) =>
        request.direction === 'older'
          ? page([plan])
          : page(initialItems, { previousCursor: 'older-running', nextCursor: 'live-running' }),
      );

    setup(page(initialItems, { previousCursor: 'older-running', nextCursor: 'live-running' }), {
      read,
    });

    expect((await screen.findAllByText('Recover TODO from running tool')).length).toBeGreaterThan(
      0,
    );
    expect(read).toHaveBeenNthCalledWith(2, {
      target: 'w1:p1',
      direction: 'older',
      limit: 256,
      cursor: 'older-running',
    });
  });

  it('preserves the pane working duration across chat view remounts', async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const workingPane = {
      ...pane,
      pane_id: 'w-timer:p1',
      agent_status: 'working',
    } as PaneInfo;
    const activeTurn = page([
      {
        id: 'started-without-timestamp',
        sequence: 1,
        provider: 'pi',
        session_id: 'session-1',
        turn_id: 'turn-timer',
        type: 'turn_state',
        state: 'started',
      },
    ]);
    const { view } = setup(activeTurn);
    view.rerender(<ConversationChatPanel pane={workingPane} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Working');

    now += 7_000;
    view.unmount();
    render(<ConversationChatPanel pane={workingPane} />);

    expect(await screen.findByRole('status')).toHaveTextContent('Working for 7S');
  });

  it('settles Working and the pinned TODO when a final answer arrives without a terminal turn event', async () => {
    setup(
      page([
        {
          id: 'started',
          sequence: 1,
          provider: 'omp',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'turn_state',
          state: 'started',
          started_ms: Date.now() - 5_000,
        },
        {
          id: 'plan',
          sequence: 2,
          provider: 'omp',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'plan_update',
          steps: [
            { label: 'Run final verification', status: 'active' },
            { label: 'Publish result', status: 'pending' },
          ],
        },
        assistant(3, 'final', 'Everything is complete.'),
      ]),
    );

    expect(await screen.findByText('Everything is complete.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="active-plan"]')).toBeNull();
  });

  it('folds settled work while keeping the rendered final answer prominent and visible', async () => {
    setup(
      page([
        assistant(1, 'commentary', 'I am checking the implementation.'),
        tool(2, 'bash', 'cargo test'),
        assistant(3, 'final', '## Result\n\n**Everything passes.**'),
        {
          id: 'user',
          sequence: 0,
          provider: 'pi',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'user_message',
          text: 'Please verify this.',
        },
        {
          id: 'completed',
          sequence: 4,
          provider: 'pi',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'turn_state',
          state: 'completed',
          duration_ms: 6_000,
        },
      ]),
    );

    const work = await screen.findByTestId('turn-work-summary');
    expect(work).not.toHaveAttribute('open');
    expect(within(work).getByText('Worked for 6S')).toBeInTheDocument();
    const answer = screen.getByTestId('final-answer');
    expect(answer).not.toBe(work);
    expect(within(answer).getByRole('heading', { name: 'Result' })).toBeInTheDocument();
    expect(within(answer).getByText('Everything passes.').tagName).toBe('STRONG');
    expect(answer).not.toHaveTextContent('**');
    expect(screen.getByText('You')).toBeInTheDocument();
    const userMessage = screen
      .getByText('Please verify this.')
      .closest('[data-slot="user-message"]');
    expect(userMessage).toHaveClass('bg-main', 'text-main-foreground');
    expect(screen.queryByText('Commentary', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Answer', { exact: true })).not.toBeInTheDocument();
  });

  it('renders a final answer larger than the former engine text limit in full', async () => {
    const ending = 'The complete final conclusion remains visible.';
    const longAnswer = `${'Detailed evidence. '.repeat(600)}\n\n${ending}`;

    setup(page([assistant(1, 'final', longAnswer)]));

    const answer = await screen.findByTestId('final-answer');
    expect(answer).toHaveTextContent(ending);
    expect(answer.textContent?.match(/Detailed evidence\./g)).toHaveLength(600);
  });

  it('renders GFM tables as readable semantic tables', async () => {
    setup(
      page([
        assistant(
          1,
          'final',
          '| # | Requested behavior | Coverage |\n| --- | --- | --- |\n| 1 | Render tables | Tested |',
        ),
      ]),
    );

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '#' })).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: 'Requested behavior' }),
    ).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'Render tables' })).toBeInTheDocument();
    expect(table.parentElement).toHaveClass('overflow-x-auto');
  });

  it('renders a local image preview inside its durable user message', async () => {
    setup(
      page([
        {
          id: 'user-with-image',
          sequence: 1,
          provider: 'omp',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'user_message',
          text: 'Review this image.',
          attachments: [
            {
              media_type: 'image/png',
              name: 'screenshot.png',
              byte_size: 128,
              preview_url: 'blob:local-preview',
            },
          ],
        },
      ]),
    );

    const preview = await screen.findByRole('img', {
      name: 'Attached image: screenshot.png',
    });
    expect(preview).toHaveAttribute('src', 'blob:local-preview');
    expect(preview).toHaveClass('size-16', 'object-cover');
  });

  it('keeps commentary between chronological work rows in an active turn', async () => {
    setup(
      page([
        {
          id: 'started',
          sequence: 1,
          provider: 'pi',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'turn_state',
          state: 'started',
        },
        tool(2, 'first tool'),
        assistant(3, 'commentary', 'Between the tools'),
        tool(4, 'second tool'),
      ]),
    );

    await screen.findByText('first tool');
    const first = screen.getByText('first tool');
    const commentary = screen.getByText('Between the tools');
    const second = screen.getByText('second tool');
    expect(
      first.compareDocumentPosition(commentary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      commentary.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps every active tool row visible instead of grouping later calls', async () => {
    setup(
      page([
        {
          id: 'started',
          sequence: 1,
          provider: 'pi',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'turn_state',
          state: 'started',
        },
        ...Array.from({ length: 6 }, (_, index) => tool(index + 2)),
      ]),
    );

    await screen.findByText('tool-7');
    expect(screen.queryByText('+2 tool calls')).not.toBeInTheDocument();
  });

  it('groups repetitive tool rows after the final answer arrives', async () => {
    setup(
      page([
        ...Array.from({ length: 6 }, (_, index) => tool(index + 1)),
        assistant(7, 'final', 'Done.'),
        {
          id: 'completed',
          sequence: 8,
          provider: 'pi',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'turn_state',
          state: 'completed',
        },
      ]),
    );

    const disclosure = await screen.findByText('+2 tool calls');
    const grouped = disclosure.closest('details');
    expect(grouped).not.toBeNull();
    expect(within(grouped as HTMLElement).getByText('tool-5')).toBeInTheDocument();
    expect(within(grouped as HTMLElement).getByText('tool-6')).toBeInTheDocument();
  });

  it('does not render a useless disclosure for a tool with no detail', async () => {
    setup(page([tool(1, 'bash')]));

    const label = await screen.findByText('bash');
    expect(label.closest('details')).toBeNull();
  });

  it('keeps a running bash command expanded during active work', async () => {
    setup(
      page([
        {
          ...tool(1, 'bash'),
          status: 'running',
          label: 'bash',
          preview: "printf 'hello\\n'",
        },
      ]),
    );

    const label = await screen.findByText('bash');
    const disclosure = label.closest('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure).toHaveAttribute('open');
    const command = within(disclosure as HTMLElement).getByText("printf 'hello\\n'");
    expect(command.tagName).toBe('CODE');
    expect(command.parentElement).toHaveClass('bg-black', 'text-white');
  });

  it('keeps completed work expanded until its final answer arrives', async () => {
    setup(
      page([
        tool(1, 'bash', 'npm test'),
        {
          id: 'completed',
          sequence: 2,
          provider: 'pi',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'turn_state',
          state: 'completed',
        },
      ]),
    );

    const disclosure = (await screen.findByText('bash')).closest('details');
    expect(disclosure).toHaveAttribute('open');
    expect(screen.queryByTestId('turn-work-summary')).not.toBeInTheDocument();
  });

  it('attaches a bounded changed-files summary below the final answer', async () => {
    setup(
      page([
        assistant(1, 'final', 'Done.'),
        ...Array.from(
          { length: 10 },
          (_, index): ConversationItem => ({
            id: `file-${index}`,
            sequence: index + 2,
            provider: 'pi',
            session_id: 'session-1',
            turn_id: 'turn-1',
            type: 'file_change',
            path: `src/file-${index}.ts`,
            change: 'modified',
          }),
        ),
        {
          id: 'completed',
          sequence: 12,
          provider: 'pi',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'turn_state',
          state: 'completed',
        },
      ]),
    );

    const response = (await screen.findByTestId('final-answer')).closest(
      '[data-testid="turn-response"]',
    );
    expect(response).not.toBeNull();
    expect(within(response as HTMLElement).getByText('Changed files')).toBeInTheDocument();
    expect(within(response as HTMLElement).getByText('src/file-0.ts')).toBeInTheDocument();
    expect(within(response as HTMLElement).getByText('+2 more files')).toBeInTheDocument();
  });
});

describe('ConversationChatPanel approval and delivery states', () => {
  it('preserves provider slash-command discovery in the structured composer', async () => {
    setup(page([]));
    const input = screen.getByRole('textbox', { name: 'Chat prompt' });
    fireEvent.change(input, { target: { value: '/mod' } });

    const commands = await screen.findByRole('listbox', { name: 'Slash commands' });
    fireEvent.click(within(commands).getByRole('option', { name: /\/model/i }));

    expect(input).toHaveValue('/model ');
  });

  it('submits only engine-advertised structured approval IDs', async () => {
    const { respond } = setup(
      page([
        {
          id: 'approval',
          sequence: 1,
          provider: 'pi',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'approval',
          request_id: 'approval-1',
          prompt: 'Allow this command?',
          decisions: [
            { id: 'allow', label: 'Allow' },
            { id: 'deny', label: 'Deny' },
          ],
          status: 'pending',
          structured_response: true,
        },
      ]),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    await waitFor(() =>
      expect(respond).toHaveBeenCalledWith({
        target: 'w1:p1',
        reader_generation: 'generation-1',
        session: { id: 'session-1' },
        request_id: 'approval-1',
        decision_id: 'allow',
      }),
    );
  });

  it('offers a real terminal fallback for a read-only approval', async () => {
    const openTerminal = vi.fn();
    const { view } = setup(
      page([
        {
          id: 'approval',
          sequence: 1,
          provider: 'pi',
          session_id: 'session-1',
          turn_id: 'turn-1',
          type: 'approval',
          request_id: 'approval-1',
          prompt: 'Confirm in terminal',
          decisions: [],
          status: 'pending',
          structured_response: false,
        },
      ]),
    );

    view.rerender(<ConversationChatPanel pane={pane} onOpenTerminal={openTerminal} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Terminal to respond' }));
    expect(openTerminal).toHaveBeenCalledTimes(1);
  });

  it('starts the Working timer when a prompt is submitted before pane status catches up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const prompt = vi.fn<Window['herdr']['conversation']['prompt']>(
      () => new Promise(() => undefined),
    );
    setup(page([]), { prompt });
    const input = screen.getByRole('textbox', { name: 'Chat prompt' });

    try {
      fireEvent.change(input, { target: { value: 'start now' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(screen.getByRole('status')).toHaveTextContent('Working');

      vi.setSystemTime(1_800_000_006_000);
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(screen.getByRole('status')).toHaveTextContent('Working for 7S');
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
  it('keeps a failed optimistic message retryable without restoring the draft', async () => {
    const prompt = vi
      .fn<Window['herdr']['conversation']['prompt']>()
      .mockRejectedValueOnce(new Error('delivery failed'))
      .mockResolvedValueOnce({} as never);
    setup(page([]), { prompt });
    const input = screen.getByRole('textbox', { name: 'Chat prompt' });
    fireEvent.change(input, { target: { value: 'retry me' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(input).toHaveValue('');
    fireEvent.click(retry);
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    expect(prompt).toHaveBeenLastCalledWith({ target: 'w1:p1', text: 'retry me' });
  });

  it('shows syncing after delivery until the durable user item arrives', async () => {
    let resolveRead: ((value: ConversationReadResult) => void) | undefined;
    const read = vi
      .fn<Window['herdr']['conversation']['read']>()
      .mockResolvedValueOnce(page([]))
      .mockImplementationOnce(
        () =>
          new Promise<ConversationReadResult>((resolve) => {
            resolveRead = resolve;
          }),
      );
    setup(page([]), { read });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const input = screen.getByRole('textbox', { name: 'Chat prompt' });
    fireEvent.change(input, { target: { value: 'sync me' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('Syncing')).toBeInTheDocument();
    act(() =>
      resolveRead?.(
        page([
          {
            id: 'durable',
            sequence: 1,
            provider: 'pi',
            session_id: 'session-1',
            turn_id: 'turn-1',
            type: 'user_message',
            text: 'sync me',
          },
        ]),
      ),
    );
    await waitFor(() => expect(screen.queryByText('Syncing')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Working');
  });
});

describe('ConversationChatPanel scroll following', () => {
  it('finishes scrolling to the bottom when Chat mounts after navigation', async () => {
    let scrollHeight = 400;
    const animationFrames: FrameRequestCallback[] = [];
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });

    setup(page([assistant(1, 'final', 'latest response')]));
    const viewport = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    await screen.findByText('latest response');
    expect(viewport.scrollTop).toBe(400);

    scrollHeight = 1_000;
    act(() => {
      for (const callback of animationFrames.splice(0)) {
        callback(performance.now());
      }
    });

    expect(viewport.scrollTop).toBe(1_000);
    scrollHeight = 1_600;
    act(() => resize?.([], {} as ResizeObserver));
    expect(viewport.scrollTop).toBe(1_600);
  });

  it('does not follow new output after the user scrolls away from the bottom', async () => {
    const setupResult = setup(page([assistant(1, 'final', 'old')], { nextCursor: 'cursor-1' }));
    const viewport = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);

    setupResult.read.mockResolvedValueOnce(
      page([assistant(2, 'commentary', 'new output')], { nextCursor: 'cursor-2' }),
    );
    act(() => {
      setupResult.onEvent()?.({
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

    await screen.findByText('new output');
    expect(viewport.scrollTop).toBe(100);
  });

  it('preserves the viewport anchor when older history is prepended', async () => {
    let scrollHeight = 1_000;
    const older = assistant(1, 'commentary', 'older item');
    const setupResult = setup(
      page([assistant(2, 'final', 'current item')], { previousCursor: 'older-1' }),
    );
    const viewport = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    });
    viewport.scrollTop = 100;
    setupResult.read.mockImplementationOnce(async () => {
      scrollHeight = 1_600;
      return page([older], { previousCursor: 'older-0' });
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Load older history' }));
    await screen.findByText('older item');
    await waitFor(() => expect(viewport.scrollTop).toBe(700));
  });
});
