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
  return tabs.filter((tab) => tab.workspace_id === workspaceId);
}

function adjacentInsertIndex(
  currentIndex: number,
  length: number,
  direction: ReorderDirection,
): number | null {
  if (currentIndex < 0) {
    return null;
  }
  if (direction === 'up') {
    return currentIndex === 0 ? null : currentIndex - 1;
  }
  return currentIndex >= length - 1 ? null : currentIndex + 2;
}

export function planWorkspaceMove(
  workspaces: readonly WorkspaceInfo[],
  workspaceId: string,
  direction: ReorderDirection,
): WorkspaceMoveIntent | null {
  const ordered = orderWorkspaces(workspaces);
  const currentIndex = ordered.findIndex((workspace) => workspace.workspace_id === workspaceId);
  const insertIndex = adjacentInsertIndex(currentIndex, ordered.length, direction);
  if (insertIndex === null) {
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
  const insertIndex = adjacentInsertIndex(currentIndex, ordered.length, direction);
  if (insertIndex === null) {
    return null;
  }
  return { tabId, insertIndex };
}
