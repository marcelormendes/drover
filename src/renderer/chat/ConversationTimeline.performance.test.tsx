import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConversationTimeline } from '@/renderer/chat/ConversationTimeline';
import type { ConversationItem } from '@/shared/conversation';

const markdownRenders = vi.hoisted(() => new Map<string, number>());

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    markdownRenders.set(children, (markdownRenders.get(children) ?? 0) + 1);
    return children;
  },
}));

function finalAnswer(sequence: number): ConversationItem {
  return {
    id: `answer-${sequence}`,
    sequence,
    provider: 'pi',
    session_id: 'session-1',
    turn_id: `turn-${sequence}`,
    type: 'assistant_message',
    phase: 'final',
    text: `Final answer ${sequence}`,
    state: 'completed',
  };
}

describe('ConversationTimeline rendering performance', () => {
  it('does not re-render historical Markdown when a new turn arrives', () => {
    markdownRenders.clear();
    const historical = Array.from({ length: 200 }, (_, index) => finalAnswer(index + 1));
    const onRespond = vi.fn();
    const view = render(
      <ConversationTimeline items={historical} paneId="w1:p1" onRespond={onRespond} />,
    );

    const latest = finalAnswer(201);
    view.rerender(
      <ConversationTimeline items={[...historical, latest]} paneId="w1:p1" onRespond={onRespond} />,
    );

    for (const item of historical) {
      expect(markdownRenders.get(item.type === 'assistant_message' ? item.text : '')).toBe(1);
    }
    expect(markdownRenders.get(latest.type === 'assistant_message' ? latest.text : '')).toBe(1);
  });
});
