import type { WorkspaceInfo } from '@/shared/herdr';

export type SpaceGroup =
  | {
      id: string;
      kind: 'workspace';
      workspace: WorkspaceInfo;
    }
  | {
      id: string;
      kind: 'worktree';
      repoKey: string;
      repoName: string;
      repoRoot: string;
      rootWorkspace?: WorkspaceInfo;
      linkedWorkspaces: WorkspaceInfo[];
    };

export function buildSpaceGroups(workspaces: readonly WorkspaceInfo[]): SpaceGroup[] {
  const groups: SpaceGroup[] = [];
  const groupsByRepo = new Map<string, Extract<SpaceGroup, { kind: 'worktree' }>>();
  const ordered = [...workspaces].sort(
    (left, right) =>
      left.number - right.number || left.workspace_id.localeCompare(right.workspace_id),
  );

  for (const workspace of ordered) {
    const worktree = workspace.worktree;
    if (!worktree) {
      groups.push({ id: `workspace:${workspace.workspace_id}`, kind: 'workspace', workspace });
      continue;
    }

    let group = groupsByRepo.get(worktree.repo_key);
    if (!group) {
      group = {
        id: `repo:${worktree.repo_key}`,
        kind: 'worktree',
        repoKey: worktree.repo_key,
        repoName: worktree.repo_name,
        repoRoot: worktree.repo_root,
        rootWorkspace: undefined,
        linkedWorkspaces: [],
      };
      groupsByRepo.set(worktree.repo_key, group);
      groups.push(group);
    }

    if (worktree.is_linked_worktree) {
      group.linkedWorkspaces.push(workspace);
    } else if (!group.rootWorkspace) {
      group.rootWorkspace = workspace;
      group.repoName = worktree.repo_name;
      group.repoRoot = worktree.repo_root;
    }
  }

  return groups;
}
