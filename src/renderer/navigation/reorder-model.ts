import type { TabInfo, WorkspaceInfo } from '@/shared/herdr';

export type ReorderDirection = 'up' | 'down';
export interface WorkspaceMoveIntent {
  workspaceId: string;
  insertIndex: number;
}
export interface TabMoveIntent {
  tabId: string;
  insertIndex: number;
}

export function orderWorkspaces(workspaces: readonly WorkspaceInfo[]): WorkspaceInfo[] {
  return [...workspaces].sort(
    (left, right) =>
      left.number - right.number || left.workspace_id.localeCompare(right.workspace_id),
  );
}

export function orderTabs(tabs: readonly TabInfo[], workspaceId: string): TabInfo[] {
  return tabs
    .filter((tab) => tab.workspace_id === workspaceId)
    .sort((left, right) => left.number - right.number || left.tab_id.localeCompare(right.tab_id));
}

export function planWorkspaceMove(
  workspaces: readonly WorkspaceInfo[],
  workspaceId: string,
  direction: ReorderDirection,
): WorkspaceMoveIntent | null {
  const ordered = orderWorkspaces(workspaces);
  const currentIndex = ordered.findIndex((workspace) => workspace.workspace_id === workspaceId);
  const insertIndex = currentIndex + (direction === 'up' ? -1 : 1);
  if (currentIndex < 0 || insertIndex < 0 || insertIndex >= ordered.length) {
    return null;
  }
  return { workspaceId, insertIndex };
}

export function planTabMove(
  tabs: readonly TabInfo[],
  workspaceId: string,
  tabId: string,
  direction: ReorderDirection,
): TabMoveIntent | null {
  const ordered = orderTabs(tabs, workspaceId);
  const currentIndex = ordered.findIndex((tab) => tab.tab_id === tabId);
  const insertIndex = currentIndex + (direction === 'up' ? -1 : 1);
  if (currentIndex < 0 || insertIndex < 0 || insertIndex >= ordered.length) {
    return null;
  }
  return { tabId, insertIndex };
}
