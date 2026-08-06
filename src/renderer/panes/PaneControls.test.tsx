import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MovePaneDialog, PaneControls } from '@/renderer/panes/PaneControls';
import type { PaneInfo, TabInfo, WorkspaceInfo } from '@/shared/herdr';

const pane: PaneInfo = {
  pane_id: 'p1',
  terminal_id: 'term-1',
  workspace_id: 'w1',
  tab_id: 't1',
  focused: true,
  label: 'Implementation',
  agent_status: 'working',
  state_labels: {},
  tokens: {},
  revision: 1,
};

const workspaces: WorkspaceInfo[] = [
  {
    workspace_id: 'w1',
    number: 1,
    label: 'Desktop',
    focused: true,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: 't1',
    agent_status: 'working',
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
];

const tabs: TabInfo[] = [
  {
    tab_id: 't1',
    workspace_id: 'w1',
    number: 1,
    label: 'Build',
    focused: true,
    pane_count: 1,
    agent_status: 'working',
  },
  {
    tab_id: 't2',
    workspace_id: 'w2',
    number: 1,
    label: 'Review',
    focused: false,
    pane_count: 1,
    agent_status: 'idle',
  },
];

describe('PaneControls', () => {
  it('emits canonical directional, topology, and lifecycle intents', async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    const onSwap = vi.fn();
    const onResize = vi.fn();
    const onSplit = vi.fn();
    const onZoom = vi.fn();
    const onRename = vi.fn();
    const onClearName = vi.fn();
    const onClose = vi.fn();

    render(
      <PaneControls
        onClearName={onClearName}
        onClose={onClose}
        onFocusDirection={onFocus}
        onMove={vi.fn()}
        onRename={onRename}
        onResizeDirection={onResize}
        onSplit={onSplit}
        onSwapDirection={onSwap}
        onZoom={onZoom}
        pane={pane}
        tabs={tabs}
        workspaces={workspaces}
      />,
    );

    for (const direction of ['left', 'right', 'up', 'down']) {
      expect(screen.getByRole('button', { name: `Focus pane ${direction}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Swap pane ${direction}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Resize pane ${direction}` })).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: 'Focus pane left' }));
    await user.click(screen.getByRole('button', { name: 'Swap pane right' }));
    await user.click(screen.getByRole('button', { name: 'Resize pane down' }));
    await user.click(screen.getByRole('button', { name: 'Split pane right' }));
    await user.click(screen.getByRole('button', { name: 'Split pane down' }));
    await user.click(screen.getByRole('button', { name: 'Toggle pane zoom' }));
    await user.click(screen.getByRole('button', { name: 'Rename pane' }));
    await user.click(screen.getByRole('button', { name: 'Clear pane name' }));
    await user.click(screen.getByRole('button', { name: 'Close pane' }));

    expect(onFocus).toHaveBeenCalledWith({ paneId: 'p1', direction: 'left' });
    expect(onSwap).toHaveBeenCalledWith({ paneId: 'p1', direction: 'right' });
    expect(onResize).toHaveBeenCalledWith({ paneId: 'p1', direction: 'down', amount: 1 });
    expect(onSplit).toHaveBeenNthCalledWith(1, { paneId: 'p1', direction: 'right' });
    expect(onSplit).toHaveBeenNthCalledWith(2, { paneId: 'p1', direction: 'down' });
    expect(onZoom).toHaveBeenCalledWith('p1');
    expect(onRename).toHaveBeenCalledWith('p1');
    expect(onClearName).toHaveBeenCalledWith('p1');
    expect(onClose).toHaveBeenCalledWith('p1');
  });

  it('disables clear name when the pane has no manual label', () => {
    render(
      <PaneControls
        onClearName={vi.fn()}
        onClose={vi.fn()}
        onFocusDirection={vi.fn()}
        onMove={vi.fn()}
        onRename={vi.fn()}
        onResizeDirection={vi.fn()}
        onSplit={vi.fn()}
        onSwapDirection={vi.fn()}
        onZoom={vi.fn()}
        pane={{ ...pane, label: undefined }}
        tabs={tabs}
        workspaces={workspaces}
      />,
    );

    expect(screen.getByRole('button', { name: 'Clear pane name' })).toBeDisabled();
  });
});

describe('MovePaneDialog', () => {
  it('moves to an existing engine-owned tab with the selected split direction', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <MovePaneDialog
        onMove={onMove}
        onOpenChange={vi.fn()}
        open
        pane={pane}
        tabs={tabs}
        workspaces={workspaces}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Select tab Review in Docs' }));
    await user.click(screen.getByRole('button', { name: 'Split down' }));
    await user.click(screen.getByRole('button', { name: 'Move pane' }));

    expect(onMove).toHaveBeenCalledWith({
      paneId: 'p1',
      destination: { type: 'tab', tabId: 't2', split: 'down' },
    });
  });

  it('moves to a new tab in a selected existing workspace', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <MovePaneDialog
        onMove={onMove}
        onOpenChange={vi.fn()}
        open
        pane={pane}
        tabs={tabs}
        workspaces={workspaces}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'New tab destination' }));
    await user.click(screen.getByRole('button', { name: 'Select workspace Docs' }));
    await user.type(screen.getByLabelText('New tab label'), 'Investigation');
    await user.click(screen.getByRole('button', { name: 'Move pane' }));

    expect(onMove).toHaveBeenCalledWith({
      paneId: 'p1',
      destination: { type: 'new-tab', workspaceId: 'w2', label: 'Investigation' },
    });
  });

  it('moves to a new workspace with optional workspace and tab labels', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <MovePaneDialog
        onMove={onMove}
        onOpenChange={vi.fn()}
        open
        pane={pane}
        tabs={tabs}
        workspaces={workspaces}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'New workspace destination' }));
    await user.type(screen.getByLabelText('New workspace label'), 'Review space');
    await user.type(screen.getByLabelText('New workspace tab label'), 'Results');
    await user.click(screen.getByRole('button', { name: 'Move pane' }));

    expect(onMove).toHaveBeenCalledWith({
      paneId: 'p1',
      destination: { type: 'new-workspace', label: 'Review space', tabLabel: 'Results' },
    });
  });

  it('shows empty, loading, and error feedback without inventing destinations', () => {
    const { rerender } = render(
      <MovePaneDialog
        onMove={vi.fn()}
        onOpenChange={vi.fn()}
        open
        pane={pane}
        tabs={[tabs[0]]}
        workspaces={workspaces}
      />,
    );

    expect(screen.getByText('No other tabs are available')).toBeInTheDocument();

    rerender(
      <MovePaneDialog
        busy
        error="The destination tab was closed."
        onMove={vi.fn()}
        onOpenChange={vi.fn()}
        open
        pane={pane}
        tabs={tabs}
        workspaces={workspaces}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The destination tab was closed.');
    expect(screen.getByRole('button', { name: 'Moving pane' })).toBeDisabled();
  });
});
