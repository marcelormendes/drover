import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PaneDetails } from '@/renderer/panes/PaneDetails';
import type { PaneInfo } from '@/shared/herdr';

const pane: PaneInfo = {
  pane_id: 'p1',
  terminal_id: 'term-1',
  workspace_id: 'w1',
  tab_id: 't1',
  focused: true,
  cwd: '/code/herdr',
  foreground_cwd: '/code/herdr/src',
  terminal_title: 'codex · reviewing',
  agent_status: 'blocked',
  state_labels: { blocked: 'Needs approval', working: 'Reviewing' },
  tokens: { model: 'gpt-5', summary: 'Review auth' },
  agent_session: { source: 'official:codex', agent: 'codex', kind: 'id', value: 'session-42' },
  scroll: { offset_from_bottom: 18, max_offset_from_bottom: 240, viewport_rows: 42 },
  revision: 9,
};

describe('PaneDetails', () => {
  it('renders canonical pane paths, terminal, scroll, metadata, and session details', () => {
    render(<PaneDetails pane={pane} />);

    const details = screen.getByRole('region', { name: 'Pane details' });
    expect(within(details).getByText('/code/herdr')).toBeInTheDocument();
    expect(within(details).getByText('/code/herdr/src')).toBeInTheDocument();
    expect(within(details).getByText('codex · reviewing')).toBeInTheDocument();
    expect(
      within(details).getByText('18 lines from bottom · 240 max · 42 viewport rows'),
    ).toBeInTheDocument();
    expect(within(details).getByText('Needs approval')).toBeInTheDocument();
    expect(within(details).getByText('Reviewing')).toBeInTheDocument();
    expect(within(details).getByText('gpt-5')).toBeInTheDocument();
    expect(within(details).getByText('Review auth')).toBeInTheDocument();
    expect(within(details).getByText('official:codex')).toBeInTheDocument();
    expect(within(details).getByText('session-42')).toBeInTheDocument();
  });

  it('renders explicit empty values and a bottom scroll state', () => {
    render(
      <PaneDetails
        pane={{
          ...pane,
          cwd: undefined,
          foreground_cwd: undefined,
          terminal_title: undefined,
          state_labels: {},
          tokens: {},
          agent_session: undefined,
          scroll: { offset_from_bottom: 0, max_offset_from_bottom: 240, viewport_rows: 42 },
        }}
      />,
    );

    expect(screen.getAllByText('Not reported').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('At bottom · 240 max · 42 viewport rows')).toBeInTheDocument();
    expect(screen.getByText('No state labels')).toBeInTheDocument();
    expect(screen.getByText('No metadata tokens')).toBeInTheDocument();
    expect(screen.getByText('No agent session')).toBeInTheDocument();
  });
});
