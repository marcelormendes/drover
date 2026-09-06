import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ConversationItem } from '@/shared/conversation';

import { ConversationTimeline } from './ConversationTimeline';

// Codex writes AGENTS instructions and environment context into one initial
// user record, immediately before the first ordinary prompt.
const instructions =
  '# AGENTS.md instructions\n\n<INSTRUCTIONS>\n# Working preferences\nPreserve unrelated work.\n</INSTRUCTIONS>';
const environment =
  '<environment_context>\n  <cwd>/private/tmp/project</cwd>\n  <shell>zsh</shell>\n</environment_context>';
const capturedShape = `${instructions}${environment}`;

function user(
  text: string,
  overrides: Partial<Extract<ConversationItem, { type: 'user_message' }>> = {},
): ConversationItem {
  return {
    id: 'user-1',
    sequence: 1,
    provider: 'codex',
    session_id: 'session-1',
    turn_id: 'turn-1',
    type: 'user_message',
    text,
    ...overrides,
  };
}

function show(items: ConversationItem[]) {
  return render(<ConversationTimeline items={items} paneId="w1:p1" onRespond={vi.fn()} />);
}

describe('Codex session context presentation', () => {
  it.each([capturedShape, instructions, environment])(
    'collapses complete context while preserving inspectable text',
    (text) => {
      show([user(text), user('Please fix the test.', { id: 'user-2', sequence: 2 })]);
      const summary = screen.getByText('Session context');
      const disclosure = summary.closest('details');
      expect(disclosure).not.toHaveAttribute('open');
      expect(disclosure?.querySelector('p')?.textContent).toBe(text);
      expect(screen.getAllByText('You')).toHaveLength(1);
      expect(screen.getByText('Please fix the test.')).toBeVisible();
      fireEvent.click(summary);
      expect(disclosure).toHaveAttribute('open');
      expect(disclosure?.querySelector('p')).toBeVisible();
    },
  );

  it('retains attachments in expanded session context', () => {
    show([
      user(capturedShape, {
        attachments: [{ name: 'reference.txt', media_type: 'text/plain', byte_size: 12 }],
      }),
    ]);
    const summary = screen.getByText('Session context');
    fireEvent.click(summary);
    expect(screen.getByText('reference.txt')).toBeVisible();
  });

  it.each([
    'Explain how AGENTS.md instructions work.',
    '# AGENTS.md instructions\nPlease improve this document.',
    `${capturedShape}\nNow implement my request.`,
    `${instructions}\nHere is my actual question.\n${environment}`,
    `${environment}\nPlease explain this environment.`,
    '<environment_context>missing closing tag',
    '<environment_context>',
    '# AGENTS.md instructions\n<INSTRUCTIONS>missing closing tag',
  ])('keeps ordinary discussion and mixed or incomplete wrappers as user messages', (text) => {
    const { container } = show([user(text)]);
    expect(screen.queryByText('Session context')).not.toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="user-message"] p')?.textContent).toBe(text);
  });

  it('does not reclassify another provider’s user message', () => {
    show([user(capturedShape, { provider: 'pi' })]);
    expect(screen.queryByText('Session context')).not.toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });
});
