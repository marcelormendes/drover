import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  CreateWorktreeDialog,
  OpenWorktreeDialog,
  RemoveWorktreeDialog,
} from '@/renderer/worktrees/WorktreeDialogs';
import type { WorkspaceInfo } from '@/shared/herdr';

const source: WorkspaceInfo = {
  workspace_id: 'root',
  number: 1,
  label: 'Herdr',
  focused: true,
  pane_count: 1,
  tab_count: 1,
  active_tab_id: 'root:t1',
  agent_status: 'idle',
  tokens: {},
  worktree: {
    repo_key: 'repo-1',
    repo_name: 'herdr',
    repo_root: '/code/herdr',
    checkout_path: '/code/herdr',
    is_linked_worktree: false,
  },
};

const linked: WorkspaceInfo = {
  ...source,
  workspace_id: 'child',
  label: 'Feature branch',
  worktree: {
    repo_key: 'repo-1',
    repo_name: 'herdr',
    repo_root: '/code/herdr',
    checkout_path: '/worktrees/feature',
    is_linked_worktree: true,
  },
};

describe('worktree dialogs', () => {
  it('submits a trimmed create intent anchored to the source workspace', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <CreateWorktreeDialog
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        sourceWorkspace={source}
      />,
    );

    await user.type(screen.getByLabelText('Branch name'), ' feature/navigation ');
    await user.type(screen.getByLabelText('Checkout path'), ' /worktrees/navigation ');
    await user.type(screen.getByLabelText('Workspace label'), ' Navigator ');
    await user.click(screen.getByRole('button', { name: 'Create worktree' }));

    expect(onSubmit).toHaveBeenCalledWith({
      workspaceId: 'root',
      branch: 'feature/navigation',
      path: '/worktrees/navigation',
      label: 'Navigator',
    });
  });

  it('submits an existing checkout path and exposes operation errors', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <OpenWorktreeDialog
        error="Checkout is already open."
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        sourceWorkspace={source}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Checkout is already open.');
    await user.type(screen.getByLabelText('Existing checkout path'), '/worktrees/docs');
    await user.click(screen.getByRole('button', { name: 'Open worktree' }));

    expect(onSubmit).toHaveBeenCalledWith({ workspaceId: 'root', path: '/worktrees/docs' });
  });

  it('requires destructive confirmation and can request a forced removal', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RemoveWorktreeDialog
        force
        onConfirm={onConfirm}
        onOpenChange={vi.fn()}
        open
        workspace={linked}
      />,
    );

    expect(screen.getByText(/branch will not be deleted/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete checkout' }));

    expect(onConfirm).toHaveBeenCalledWith({ workspaceId: 'child', force: true });
  });

  it('disables destructive confirmation while an operation is loading', () => {
    render(
      <RemoveWorktreeDialog
        busy
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        open
        workspace={linked}
      />,
    );

    expect(screen.getByRole('button', { name: 'Deleting checkout' })).toBeDisabled();
  });
});
