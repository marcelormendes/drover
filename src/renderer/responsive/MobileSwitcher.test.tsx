import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MobileSwitcher, type MobileSwitcherProps } from '@/renderer/responsive/MobileSwitcher';
import { snapshot } from '@/renderer/responsive/test-fixtures';
import type { SessionSnapshot } from '@/shared/herdr';

const renderSwitcher = (
  activeSection: MobileSwitcherProps['activeSection'],
  overrides: Partial<MobileSwitcherProps> = {},
) => {
  const props: MobileSwitcherProps = {
    snapshot,
    activeSection,
    onSectionChange: vi.fn(),
    onFocusWorkspace: vi.fn(),
    onFocusTab: vi.fn(),
    onFocusPane: vi.fn(),
    onOpenNavigator: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onNewWorkspace: vi.fn(),
    onNewTab: vi.fn(),
    ...overrides,
  };
  return { ...render(<MobileSwitcher {...props} />), props };
};

describe('MobileSwitcher', () => {
  it('renders agent attention, status, location, and pane focus callbacks', async () => {
    const user = userEvent.setup();
    const { props } = renderSwitcher('agents');

    expect(screen.getByText('2 agents need attention')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('Desktop · Build')).toBeInTheDocument();
    expect(screen.getByText('blocked')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Focus agent reviewer' }));

    expect(props.onFocusPane).toHaveBeenCalledWith('p1');
  });

  it('resolves agent locations outside the active workspace from the canonical snapshot', () => {
    renderSwitcher('agents', {
      snapshot: {
        ...snapshot,
        agents: [
          {
            ...snapshot.agents[0],
            pane_id: 'p3',
            terminal_id: 'p3',
            workspace_id: 'w2',
            tab_id: 't3',
          },
        ],
      },
    });

    expect(screen.getByText('Docs · Guide')).toBeInTheDocument();
  });

  it('renders canonical spaces and forwards new/focus actions', async () => {
    const user = userEvent.setup();
    const { props } = renderSwitcher('spaces');

    await user.click(screen.getByRole('button', { name: 'Focus workspace Docs' }));
    await user.click(screen.getByRole('button', { name: 'New workspace' }));

    expect(props.onFocusWorkspace).toHaveBeenCalledWith('w2');
    expect(props.onNewWorkspace).toHaveBeenCalledOnce();
    expect(screen.getByText('2 tabs · 2 panes')).toBeInTheDocument();
  });

  it('shows only the active workspace tabs and creates a tab there', async () => {
    const user = userEvent.setup();
    const { props } = renderSwitcher('tabs');

    expect(screen.getByRole('button', { name: 'Focus tab Build' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus tab Tests' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Focus tab Guide' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Focus tab Tests' }));
    await user.click(screen.getByRole('button', { name: 'New tab in Desktop' }));

    expect(props.onFocusTab).toHaveBeenCalledWith('t2');
    expect(props.onNewTab).toHaveBeenCalledWith('w1');
  });

  it('exposes the finite menu callbacks', async () => {
    const user = userEvent.setup();
    const { props } = renderSwitcher('menu');

    await user.click(screen.getByRole('button', { name: 'Open Navigator' }));
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await user.click(screen.getByRole('button', { name: 'Open keyboard shortcuts' }));
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    await user.click(screen.getByRole('button', { name: 'Create tab in Desktop' }));

    expect(props.onOpenNavigator).toHaveBeenCalledOnce();
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
    expect(props.onOpenShortcuts).toHaveBeenCalledOnce();
    expect(props.onNewWorkspace).toHaveBeenCalledOnce();
    expect(props.onNewTab).toHaveBeenCalledWith('w1');
  });

  it.each([
    ['agents', 'No agents running'],
    ['spaces', 'No spaces yet'],
    ['tabs', 'No tabs in the active space'],
  ] as const)('renders the %s empty state', (activeSection, message) => {
    const empty: SessionSnapshot = {
      ...snapshot,
      focused_workspace_id: undefined,
      focused_tab_id: undefined,
      focused_pane_id: undefined,
      workspaces: [],
      tabs: [],
      panes: [],
      agents: [],
    };

    renderSwitcher(activeSection, { snapshot: empty });
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
