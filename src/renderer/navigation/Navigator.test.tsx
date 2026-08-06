import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Navigator } from '@/renderer/navigation/Navigator';
import type { SessionSnapshot } from '@/shared/herdr';

const snapshot: SessionSnapshot = {
  version: '0.8.0',
  protocol: 7,
  focused_workspace_id: 'w1',
  focused_tab_id: 't1',
  focused_pane_id: 'p1',
  workspaces: [
    {
      workspace_id: 'w1',
      number: 1,
      label: 'Desktop',
      focused: true,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: 't1',
      agent_status: 'blocked',
      tokens: {},
    },
    {
      workspace_id: 'w2',
      number: 2,
      label: 'Docs',
      focused: false,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: 't2',
      agent_status: 'idle',
      tokens: {},
    },
  ],
  tabs: [
    {
      tab_id: 't1',
      workspace_id: 'w1',
      number: 1,
      label: 'Implementation',
      focused: true,
      pane_count: 1,
      agent_status: 'blocked',
    },
    {
      tab_id: 't2',
      workspace_id: 'w2',
      number: 1,
      label: 'Guide',
      focused: false,
      pane_count: 1,
      agent_status: 'idle',
    },
  ],
  panes: [
    {
      pane_id: 'p1',
      terminal_id: 'term-1',
      workspace_id: 'w1',
      tab_id: 't1',
      focused: true,
      label: 'Reviewer',
      display_agent: 'Codex',
      agent_status: 'blocked',
      state_labels: {},
      tokens: {},
      revision: 1,
    },
    {
      pane_id: 'p2',
      terminal_id: 'term-2',
      workspace_id: 'w2',
      tab_id: 't2',
      focused: false,
      label: 'Editor',
      agent_status: 'idle',
      state_labels: {},
      tokens: {},
      revision: 1,
    },
  ],
  layouts: [],
  agents: [],
};

describe('Navigator', () => {
  it('searches the hierarchy and focuses the selected pane from the keyboard', async () => {
    const user = userEvent.setup();
    const onFocusPane = vi.fn();

    render(
      <Navigator
        onFocusPane={onFocusPane}
        onFocusTab={vi.fn()}
        onFocusWorkspace={vi.fn()}
        snapshot={snapshot}
      />,
    );

    const search = screen.getByRole('searchbox', { name: 'Search session' });
    await user.type(search, 'reviewer');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onFocusPane).toHaveBeenCalledWith('p1');
    expect(screen.getByRole('option', { name: /reviewer/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('offers the four upstream status filters and an empty result state', async () => {
    const user = userEvent.setup();
    render(
      <Navigator
        onFocusPane={vi.fn()}
        onFocusTab={vi.fn()}
        onFocusWorkspace={vi.fn()}
        snapshot={snapshot}
      />,
    );

    for (const status of ['Blocked', 'Working', 'Idle', 'Done']) {
      expect(screen.getByRole('button', { name: status })).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('No matching session targets')).toBeInTheDocument();
  });
});
