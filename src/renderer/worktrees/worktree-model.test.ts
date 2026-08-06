import { describe, expect, it } from 'vitest';

import { buildSpaceGroups } from '@/renderer/worktrees/worktree-model';
import type { WorkspaceInfo } from '@/shared/herdr';

const workspace = (
  workspaceId: string,
  number: number,
  worktree?: WorkspaceInfo['worktree'],
): WorkspaceInfo => ({
  workspace_id: workspaceId,
  number,
  label: workspaceId,
  focused: false,
  pane_count: 1,
  tab_count: 1,
  active_tab_id: `${workspaceId}:t1`,
  agent_status: 'idle',
  tokens: {},
  worktree,
});

describe('buildSpaceGroups', () => {
  it('groups repository roots and linked worktrees by the canonical repo key', () => {
    const groups = buildSpaceGroups([
      workspace('standalone', 4),
      workspace('linked-b', 3, {
        repo_key: 'repo-1',
        repo_name: 'herdr',
        repo_root: '/code/herdr',
        checkout_path: '/worktrees/b',
        is_linked_worktree: true,
      }),
      workspace('root', 1, {
        repo_key: 'repo-1',
        repo_name: 'herdr',
        repo_root: '/code/herdr',
        checkout_path: '/code/herdr',
        is_linked_worktree: false,
      }),
      workspace('linked-a', 2, {
        repo_key: 'repo-1',
        repo_name: 'herdr',
        repo_root: '/code/herdr',
        checkout_path: '/worktrees/a',
        is_linked_worktree: true,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      id: 'repo:repo-1',
      kind: 'worktree',
      repoKey: 'repo-1',
      rootWorkspace: { workspace_id: 'root' },
    });
    expect(
      groups[0]?.kind === 'worktree' && groups[0].linkedWorkspaces.map((item) => item.workspace_id),
    ).toEqual(['linked-a', 'linked-b']);
    expect(groups[1]).toMatchObject({
      id: 'workspace:standalone',
      kind: 'workspace',
      workspace: { workspace_id: 'standalone' },
    });
  });

  it('keeps a linked checkout visible when no root workspace is open', () => {
    const groups = buildSpaceGroups([
      workspace('orphan', 1, {
        repo_key: 'repo-2',
        repo_name: 'other',
        repo_root: '/code/other',
        checkout_path: '/worktrees/orphan',
        is_linked_worktree: true,
      }),
    ]);

    expect(groups[0]).toMatchObject({
      kind: 'worktree',
      rootWorkspace: undefined,
      linkedWorkspaces: [{ workspace_id: 'orphan' }],
    });
  });
});
