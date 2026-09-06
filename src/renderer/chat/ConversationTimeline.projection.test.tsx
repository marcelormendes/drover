import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ConversationItem } from '@/shared/conversation';

import { ConversationTimeline } from './ConversationTimeline';

const reusedTurn = '01a07456-dc74-7fc2-ac6b-141b83e03aa9';
function pair(
  number: number,
): [
  Extract<ConversationItem, { type: 'user_message' }>,
  Extract<ConversationItem, { type: 'assistant_message' }>,
] {
  const base = { provider: 'codex', session_id: 'session-1', turn_id: reusedTurn };
  return [
    {
      ...base,
      id: `user-${number}`,
      sequence: number * 2,
      type: 'user_message',
      text: `SHORT-${number}: Name one district.`,
    },
    {
      ...base,
      id: `answer-${number}`,
      sequence: number * 2 + 1,
      type: 'assistant_message',
      phase: 'final',
      state: 'completed',
      text: `SHORT-${number}: The Sunray District.`,
    },
  ];
}
const onRespond = vi.fn();
function timeline(items: ConversationItem[]) {
  return <ConversationTimeline items={items} paneId="w1:p1" onRespond={onRespond} />;
}
function messages(container: HTMLElement) {
  return [
    ...container.querySelectorAll('[data-slot="user-message"] p, [data-testid="final-answer"]'),
  ].map((node) => node.textContent);
}

describe('ConversationTimeline reused provider turns', () => {
  it.each([2, 3])(
    'preserves %s consecutive user/reply pairs sharing the captured Codex turn ID',
    (count) => {
      const items = Array.from({ length: count }, (_, index) => pair(173 + index)).flat();
      const { container } = render(timeline(items));
      expect(messages(container)).toEqual(items.map((item) => ('text' in item ? item.text : '')));
      expect(container.querySelectorAll('[data-slot="conversation-turn"]')).toHaveLength(count);
    },
  );

  it('keeps work and approvals with their user before the next exchange', () => {
    const [firstUser, firstAnswer] = pair(173);
    const base = { provider: 'codex', session_id: 'session-1', turn_id: reusedTurn };
    const items: ConversationItem[] = [
      firstUser,
      {
        ...base,
        id: 'tool',
        sequence: 347,
        type: 'tool_activity',
        action: 'Read',
        label: 'Read context',
        status: 'completed',
        detail: 'Original tool detail',
      },
      {
        ...base,
        id: 'approval',
        sequence: 348,
        type: 'approval',
        request_id: 'approval',
        prompt: 'Allow reading?',
        decisions: [{ id: 'allow', label: 'Allow' }],
        status: 'resolved',
        structured_response: false,
      },
      firstAnswer,
      ...pair(174),
    ];
    const { container } = render(timeline(items));
    const turns = container.querySelectorAll('[data-slot="conversation-turn"]');
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveTextContent('Read context');
    expect(turns[0]).toHaveTextContent('Allow reading?');
    expect(turns[0]).toHaveTextContent('SHORT-173: The Sunray District.');
    expect(turns[1]).not.toHaveTextContent('Read context');
  });

  it('splits a new user after unfinished work even before a final answer', () => {
    const [firstUser] = pair(173);
    const work: ConversationItem = {
      ...firstUser,
      id: 'working-tool',
      type: 'tool_activity',
      action: 'Read',
      label: 'Read context',
      status: 'running',
    };
    const { container } = render(timeline([firstUser, work, ...pair(174)]));
    const turns = container.querySelectorAll('[data-slot="conversation-turn"]');
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveTextContent('Read context');
    expect(turns[0]).not.toHaveTextContent('SHORT-174');
  });

  it('keeps existing user and response DOM when older same-ID pairs are prepended and a reply streams', () => {
    const existing = pair(175);
    const view = render(timeline(existing));
    const userNode = screen.getByText('SHORT-175: Name one district.');
    const answerNode = screen.getByText('SHORT-175: The Sunray District.');
    view.rerender(timeline([...pair(173), ...pair(174), ...existing]));
    expect(screen.getByText('SHORT-175: Name one district.')).toBe(userNode);
    expect(screen.getByText('SHORT-175: The Sunray District.')).toBe(answerNode);
    const next = pair(176);
    view.rerender(timeline([...pair(173), ...pair(174), ...existing, next[0]]));
    const nextUser = screen.getByText('SHORT-176: Name one district.');
    view.rerender(timeline([...pair(173), ...pair(174), ...existing, ...next]));
    expect(screen.getByText('SHORT-176: Name one district.')).toBe(nextUser);
    expect(screen.getByText('SHORT-175: The Sunray District.')).toBe(answerNode);
  });

  it('preserves an expanded context disclosure when earlier exchanges are loaded', () => {
    const context: ConversationItem = {
      ...pair(175)[0],
      text: '<environment_context>project</environment_context>',
    };
    const current = [context, pair(175)[1]];
    const view = render(timeline(current));
    const summary = screen.getByText('Session context');
    fireEvent.click(summary);
    const disclosure = summary.closest('details');
    expect(disclosure).toHaveAttribute('open');
    view.rerender(timeline([...pair(174), ...current]));
    expect(screen.getByText('Session context').closest('details')).toBe(disclosure);
    expect(disclosure).toHaveAttribute('open');
  });
});
