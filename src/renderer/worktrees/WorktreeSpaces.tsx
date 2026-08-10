import { ChevronDown, ChevronRight, FolderGit2, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { statusDotClass } from '@/renderer/status';
import { buildSpaceGroups } from '@/renderer/worktrees/worktree-model';
import type { AgentStatus, WorkspaceInfo } from '@/shared/herdr';

function workspaceRowClass(focused?: boolean): string {
  return cn(
    'flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-base px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
    focused && 'bg-accent-surface text-main',
  );
}

const ghostActionClass =
  'inline-flex items-center gap-1 rounded-base px-2 py-1 font-mono text-[11px] opacity-60 hover:bg-accent-surface hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

function WorkspaceStatus({ status }: { status: AgentStatus }) {
  return (
    <>
      <span aria-hidden="true" className={statusDotClass(status)} />
      <span className="sr-only">{status}</span>
    </>
  );
}

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
    <nav aria-label="Spaces" className="space-y-0.5">
      {groups.map((group) => {
        if (group.kind === 'workspace') {
          return (
            <button
              aria-label={`Focus workspace ${group.workspace.label}`}
              className={workspaceRowClass(group.workspace.focused)}
              key={group.id}
              onClick={() => onFocusWorkspace(group.workspace.workspace_id)}
              type="button"
            >
              <WorkspaceStatus status={group.workspace.agent_status} />
              <span className="min-w-0 flex-1 truncate">{group.workspace.label}</span>
            </button>
          );
        }

        const isExpanded = expanded.has(group.repoKey);
        const rootWorkspace = group.rootWorkspace;
        const source = rootWorkspace || group.linkedWorkspaces[0];
        return (
          <div className="space-y-0.5" key={group.id}>
            <div className="flex min-w-0 items-center gap-1 overflow-hidden rounded-base px-1 py-1">
              <button
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${group.repoName} worktrees`}
                className="grid size-6 shrink-0 place-items-center rounded-base opacity-60 hover:bg-accent-surface hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => toggle(group.repoKey)}
                type="button"
              >
                {isExpanded ? (
                  <ChevronDown aria-hidden="true" className="size-3.5" />
                ) : (
                  <ChevronRight aria-hidden="true" className="size-3.5" />
                )}
              </button>
              <FolderGit2 aria-hidden="true" className="size-3.5 shrink-0 opacity-60" />
              <span className="min-w-0 flex-1 truncate text-sm">{group.repoName}</span>
              <span className="shrink-0 font-mono text-xs opacity-50">
                {group.linkedWorkspaces.length}
              </span>
            </div>
            {rootWorkspace ? (
              <button
                aria-label={`Focus workspace ${rootWorkspace.label}`}
                className={cn(workspaceRowClass(rootWorkspace.focused), 'pl-7')}
                onClick={() => onFocusWorkspace(rootWorkspace.workspace_id)}
                type="button"
              >
                <WorkspaceStatus status={rootWorkspace.agent_status} />
                <span className="min-w-0 flex-1 truncate">{rootWorkspace.label}</span>
                <span className="shrink-0 font-mono text-[11px] opacity-50">root</span>
              </button>
            ) : null}
            {isExpanded ? (
              group.linkedWorkspaces.length === 0 ? (
                <p className="py-1 pl-7 font-mono text-xs opacity-50">No linked worktrees open</p>
              ) : (
                group.linkedWorkspaces.map((workspace) => (
                  <div className="group/worktree relative" key={workspace.workspace_id}>
                    <button
                      aria-label={`Focus workspace ${workspace.label}`}
                      className={cn(workspaceRowClass(workspace.focused), 'pl-7 pr-8')}
                      onClick={() => onFocusWorkspace(workspace.workspace_id)}
                      type="button"
                    >
                      <WorkspaceStatus status={workspace.agent_status} />
                      <span className="min-w-0 flex-1 truncate">{workspace.label}</span>
                    </button>
                    <button
                      aria-label={`Remove worktree ${workspace.label}`}
                      className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-base opacity-0 hover:bg-background focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring group-hover/worktree:opacity-60 group-hover/worktree:hover:opacity-100"
                      onClick={() => onRemoveWorktree(workspace)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                ))
              )
            ) : null}
            {source ? (
              <div className="flex items-center gap-1 pl-7">
                <button
                  aria-label={`Create worktree for ${source.label}`}
                  className={ghostActionClass}
                  onClick={() => onCreateWorktree(source)}
                  type="button"
                >
                  <Plus aria-hidden="true" className="size-3" /> Worktree
                </button>
                <button
                  aria-label={`Open worktree for ${source.label}`}
                  className={ghostActionClass}
                  onClick={() => onOpenWorktree(source)}
                  type="button"
                >
                  <FolderOpen aria-hidden="true" className="size-3" /> Open
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
