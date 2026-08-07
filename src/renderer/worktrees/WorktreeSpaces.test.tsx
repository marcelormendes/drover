import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WorktreeSpaces } from '@/renderer/worktrees/WorktreeSpaces';
import type { WorkspaceInfo } from '@/shared/herdr';

const workspaces: WorkspaceInfo[] = [
  {
    workspace_id: 'root',
    number: 1,
    label: 'Herdr',
    focused: true,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: 'root:t1',
    agent_status: 'working',
    tokens: {},
    worktree: {
      repo_key: 'repo-1',
      repo_name: 'herdr',
      repo_root: '/code/herdr',
      checkout_path: '/code/herdr',
      is_linked_worktree: false,
    },
  },
  {
    workspace_id: 'child',
    number: 2,
    label: 'Feature branch',
    focused: false,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: 'child:t1',
    agent_status: 'blocked',
    tokens: {},
    worktree: {
      repo_key: 'repo-1',
      repo_name: 'herdr',
      repo_root: '/code/herdr',
      checkout_path: '/worktrees/feature',
      is_linked_worktree: true,
    },
  },
];

describe('WorktreeSpaces', () => {
  it.each([
    ['loading', { loading: true }, 'Loading spaces'],
    ['error', { error: 'Git is unavailable.' }, 'Git is unavailable.'],
    ['empty', { workspaces: [] }, 'No spaces yet'],
  ])('renders its %s state', (_name, props, message) => {
    render(
      <WorktreeSpaces
        onCreateWorktree={vi.fn()}
        onFocusWorkspace={vi.fn()}
        onOpenWorktree={vi.fn()}
        onRemoveWorktree={vi.fn()}
        workspaces={workspaces}
        {...props}
      />,
    );

    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('expands groups and exposes canonical workspace action callbacks', async () => {
    const user = userEvent.setup();
    const onFocusWorkspace = vi.fn();
    const onCreateWorktree = vi.fn();
    const onOpenWorktree = vi.fn();
    const onRemoveWorktree = vi.fn();
    render(
      <WorktreeSpaces
        defaultExpandedRepoKeys={['repo-1']}
        onCreateWorktree={onCreateWorktree}
        onFocusWorkspace={onFocusWorkspace}
        onOpenWorktree={onOpenWorktree}
        onRemoveWorktree={onRemoveWorktree}
        workspaces={workspaces}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Focus workspace Feature branch' }));
    await user.click(screen.getByRole('button', { name: 'Create worktree for Herdr' }));
    await user.click(screen.getByRole('button', { name: 'Open worktree for Herdr' }));
    await user.click(screen.getByRole('button', { name: 'Remove worktree Feature branch' }));

    expect(onFocusWorkspace).toHaveBeenCalledWith('child');
    expect(onCreateWorktree).toHaveBeenCalledWith(workspaces[0]);
    expect(onOpenWorktree).toHaveBeenCalledWith(workspaces[0]);
    expect(onRemoveWorktree).toHaveBeenCalledWith(workspaces[1]);

    await user.click(screen.getByRole('button', { name: 'Collapse herdr worktrees' }));
    expect(
      screen.queryByRole('button', { name: 'Focus workspace Feature branch' }),
    ).not.toBeInTheDocument();
  });

  it('contains long workspace labels and status badges inside the sidebar row', () => {
    render(
      <WorktreeSpaces
        onCreateWorktree={vi.fn()}
        onFocusWorkspace={vi.fn()}
        onOpenWorktree={vi.fn()}
        onRemoveWorktree={vi.fn()}
        workspaces={[
          {
            ...workspaces[0],
            focused: false,
            worktree: undefined,
            label: 'a-very-long-workspace-label-that-must-not-push-the-status-outside',
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: /a-very-long-workspace-label/i })).toHaveClass(
      'min-w-0',
      'overflow-hidden',
      'rounded-base',
    );
  });
});
