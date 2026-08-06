import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AgentSidebar } from '@/renderer/agents/AgentSidebar';
import type { AgentInfo } from '@/shared/herdr';

function agent(overrides: Partial<AgentInfo>): AgentInfo {
  return {
    pane_id: 'w1:p1',
    terminal_id: 'terminal-1',
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: false,
    display_agent: 'Codex',
    agent_status: 'idle',
    state_labels: {},
    tokens: {},
    revision: 1,
    screen_detection_skipped: false,
    launch_pending: false,
    interactive_ready: true,
    state_change_seq: 1,
    ...overrides,
  };
}

const agents = [
  agent({
    pane_id: 'w1:p1',
    name: 'builder',
    agent_status: 'working',
    state_labels: { phase: 'implementing' },
    agent_session: { source: 'codex', agent: 'codex', kind: 'thread', value: 'thread-123' },
  }),
  agent({ pane_id: 'w2:p1', workspace_id: 'w2', name: 'reviewer', agent_status: 'blocked' }),
];

describe('AgentSidebar', () => {
  it('renders canonical agent identity, readiness, state labels, and session details', () => {
    render(
      <AgentSidebar
        agents={agents}
        onFocus={vi.fn()}
        onPrompt={vi.fn()}
        onRename={vi.fn()}
        onSortChange={vi.fn()}
        sort="spaces"
      />,
    );

    const builder = screen.getByTestId('agent-card-w1:p1');
    expect(within(builder).getByText('builder')).toBeInTheDocument();
    expect(within(builder).getByText('Ready')).toBeInTheDocument();
    expect(within(builder).getByText('implementing')).toBeInTheDocument();
    expect(within(builder).getByText('thread-123')).toBeInTheDocument();
  });

  it('orders attention states first and exposes focus, rename, and prompt workflows', async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    const onRename = vi.fn();
    const onPrompt = vi.fn();
    const { rerender } = render(
      <AgentSidebar
        agents={agents}
        onFocus={onFocus}
        onPrompt={onPrompt}
        onRename={onRename}
        onSortChange={vi.fn()}
        sort="priority"
      />,
    );

    const cards = screen.getAllByTestId(/^agent-card-/);
    expect(cards.map((card) => card.dataset.testid)).toEqual([
      'agent-card-w2:p1',
      'agent-card-w1:p1',
    ]);

    await user.click(within(cards[0]).getByRole('button', { name: 'Focus reviewer' }));
    expect(onFocus).toHaveBeenCalledWith(agents[1]);

    await user.click(within(cards[0]).getByRole('button', { name: 'Rename reviewer' }));
    await user.clear(screen.getByLabelText('Agent name'));
    await user.type(screen.getByLabelText('Agent name'), 'security-review');
    await user.click(screen.getByRole('button', { name: 'Save agent name' }));
    expect(onRename).toHaveBeenCalledWith('w2:p1', 'security-review');

    rerender(
      <AgentSidebar
        agents={agents}
        onFocus={onFocus}
        onPrompt={onPrompt}
        onRename={onRename}
        onSortChange={vi.fn()}
        sort="priority"
      />,
    );
    await user.click(
      within(screen.getByTestId('agent-card-w2:p1')).getByRole('button', {
        name: 'Prompt reviewer',
      }),
    );
    await user.type(screen.getByLabelText('Prompt'), 'Review the authentication changes');
    await user.click(screen.getByRole('button', { name: 'Send prompt' }));
    expect(onPrompt).toHaveBeenCalledWith('w2:p1', 'Review the authentication changes');
  });
});
