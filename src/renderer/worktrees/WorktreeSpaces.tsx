import { ChevronDown, ChevronRight, FolderGit2, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { buildSpaceGroups } from '@/renderer/worktrees/worktree-model';
import type { WorkspaceInfo } from '@/shared/herdr';

export interface WorktreeSpacesProps {
  workspaces: readonly WorkspaceInfo[];
  loading?: boolean;
  error?: string;
  defaultExpandedRepoKeys?: readonly string[];
  onExpandedRepoKeysChange?: (repoKeys: string[]) => void;
  onFocusWorkspace: (workspaceId: string) => void;
  onCreateWorktree: (workspace: WorkspaceInfo) => void;
  onOpenWorktree: (workspace: WorkspaceInfo) => void;
  onRemoveWorktree: (workspace: WorkspaceInfo) => void;
}

export function WorktreeSpaces({
  workspaces,
  loading = false,
  error,
  defaultExpandedRepoKeys = [],
  onExpandedRepoKeysChange,
  onFocusWorkspace,
  onCreateWorktree,
  onOpenWorktree,
  onRemoveWorktree,
}: WorktreeSpacesProps) {
  const groups = useMemo(() => buildSpaceGroups(workspaces), [workspaces]);
  const [expanded, setExpanded] = useState(() => new Set(defaultExpandedRepoKeys));

  if (loading) {
    return (
      <Card aria-busy="true" className="gap-3 bg-secondary-background">
        <CardHeader>
          <CardTitle>Loading spaces</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-secondary-background" role="alert">
        <CardHeader>
          <CardTitle>Spaces unavailable</CardTitle>
        </CardHeader>
        <CardContent>{error}</CardContent>
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card className="bg-secondary-background text-center">
        <CardHeader>
          <CardTitle>No spaces yet</CardTitle>
        </CardHeader>
        <CardContent>Create a workspace in Herdr to begin.</CardContent>
      </Card>
    );
  }

  const toggle = (repoKey: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(repoKey)) {
        next.delete(repoKey);
      } else {
        next.add(repoKey);
      }
      onExpandedRepoKeysChange?.([...next].sort());
      return next;
    });
  };

  return (
    <nav aria-label="Spaces" className="space-y-3">
      {groups.map((group) => {
        if (group.kind === 'workspace') {
          return (
            <Button
              aria-label={`Focus workspace ${group.workspace.label}`}
              className="h-auto min-w-0 w-full justify-start overflow-hidden px-3 py-3 shadow-none! hover:translate-x-0! hover:translate-y-0!"
              key={group.id}
              onClick={() => onFocusWorkspace(group.workspace.workspace_id)}
              variant={group.workspace.focused ? 'noShadow' : 'neutral'}
            >
              <FolderOpen aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left font-heading">
                {group.workspace.label}
              </span>
              <Badge variant="neutral">{group.workspace.agent_status}</Badge>
            </Button>
          );
        }

        const isExpanded = expanded.has(group.repoKey);
        const rootWorkspace = group.rootWorkspace;
        const source = rootWorkspace || group.linkedWorkspaces[0];
        return (
          <Card className="gap-0 bg-secondary-background py-0" key={group.id}>
            <div className="flex items-center gap-2 border-b-2 border-border p-2">
              <Button
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${group.repoName} worktrees`}
                className="size-8"
                onClick={() => toggle(group.repoKey)}
                size="icon"
                type="button"
                variant="neutral"
              >
                {isExpanded ? (
                  <ChevronDown aria-hidden="true" />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )}
              </Button>
              <FolderGit2 aria-hidden="true" className="size-4" />
              <span className="min-w-0 flex-1 truncate font-heading">{group.repoName}</span>
              <Badge variant="neutral">{group.linkedWorkspaces.length}</Badge>
            </div>
            {rootWorkspace ? (
              <Button
                aria-label={`Focus workspace ${rootWorkspace.label}`}
                className="m-2 h-auto justify-start px-3 py-2"
                onClick={() => onFocusWorkspace(rootWorkspace.workspace_id)}
                variant={rootWorkspace.focused ? 'noShadow' : 'neutral'}
              >
                <span className="min-w-0 flex-1 truncate text-left">{rootWorkspace.label}</span>
                <Badge variant="neutral">root</Badge>
              </Button>
            ) : null}
            {isExpanded ? (
              <div className="space-y-2 border-t-2 border-border p-2">
                {group.linkedWorkspaces.length === 0 ? (
                  <p className="px-2 py-3 text-sm opacity-70">No linked worktrees open</p>
                ) : (
                  group.linkedWorkspaces.map((workspace) => (
                    <div className="flex items-center gap-2" key={workspace.workspace_id}>
                      <Button
                        aria-label={`Focus workspace ${workspace.label}`}
                        className="h-auto min-w-0 flex-1 justify-start px-3 py-2"
                        onClick={() => onFocusWorkspace(workspace.workspace_id)}
                        variant={workspace.focused ? 'noShadow' : 'neutral'}
                      >
                        <span className="min-w-0 flex-1 truncate text-left">{workspace.label}</span>
                        <Badge variant="neutral">{workspace.agent_status}</Badge>
                      </Button>
                      <Button
                        aria-label={`Remove worktree ${workspace.label}`}
                        className="size-9"
                        onClick={() => onRemoveWorktree(workspace)}
                        size="icon"
                        type="button"
                        variant="neutral"
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            ) : null}
            {source ? (
              <div className="flex gap-2 border-t-2 border-border p-2">
                <Button
                  aria-label={`Create worktree for ${source.label}`}
                  className="min-w-0 flex-1"
                  onClick={() => onCreateWorktree(source)}
                  size="sm"
                  type="button"
                >
                  <Plus aria-hidden="true" /> Create
                </Button>
                <Button
                  aria-label={`Open worktree for ${source.label}`}
                  className="min-w-0 flex-1"
                  onClick={() => onOpenWorktree(source)}
                  size="sm"
                  type="button"
                  variant="neutral"
                >
                  <FolderOpen aria-hidden="true" /> Open
                </Button>
              </div>
            ) : null}
          </Card>
        );
      })}
    </nav>
  );
}
