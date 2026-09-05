import type { AgentStatus, SessionSnapshot } from '@/shared/herdr';

export type NavigatorFilter = 'all' | 'blocked' | 'working' | 'idle' | 'done';
export type NavigatorKind = 'workspace' | 'tab' | 'pane';
export type NavigatorMove = 'previous' | 'next' | 'first' | 'last';

export interface NavigatorRow {
  key: string;
  id: string;
  kind: NavigatorKind;
  depth: 0 | 1 | 2;
  label: string;
  meta: string;
  status: AgentStatus;
  current: boolean;
  matched: boolean;
  workspaceId: string;
  tabId?: string;
}

function compareNumberThenId(
  left: { number: number },
  right: { number: number },
  leftId: string,
  rightId: string,
) {
  return left.number - right.number || leftId.localeCompare(rightId);
}

function count(total: number, noun: string): string {
  return `${total} ${noun}${total === 1 ? '' : 's'}`;
}

function queryMatches(words: string[], values: Array<string | undefined>): boolean {
  if (words.length === 0) {
    return true;
  }
  const haystack = values.filter(Boolean).join(' ').toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

function statusMatches(status: AgentStatus, filter: NavigatorFilter) {
  return filter === 'all' || status === filter;
}

export function buildNavigatorRows(
  snapshot: SessionSnapshot,
  options: { query: string; filter: NavigatorFilter },
): NavigatorRow[] {
  const rows: NavigatorRow[] = [];
  const queryWords = options.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const tabsByWorkspace = new Map<string, SessionSnapshot['tabs']>();
  const panesByTab = new Map<string, SessionSnapshot['panes']>();
  for (const tab of snapshot.tabs) {
    const siblings = tabsByWorkspace.get(tab.workspace_id);
    if (siblings) siblings.push(tab);
    else tabsByWorkspace.set(tab.workspace_id, [tab]);
  }
  for (const pane of snapshot.panes) {
    const siblings = panesByTab.get(pane.tab_id);
    if (siblings) siblings.push(pane);
    else panesByTab.set(pane.tab_id, [pane]);
  }
  const workspaces = [...snapshot.workspaces].sort((left, right) =>
    compareNumberThenId(left, right, left.workspace_id, right.workspace_id),
  );

  for (const workspace of workspaces) {
    const workspaceRow: NavigatorRow = {
      key: `workspace:${workspace.workspace_id}`,
      id: workspace.workspace_id,
      kind: 'workspace',
      depth: 0,
      label: workspace.label,
      meta: `${count(workspace.tab_count, 'tab')} · ${count(workspace.pane_count, 'pane')}`,
      status: workspace.agent_status,
      current: snapshot.focused_workspace_id === workspace.workspace_id,
      matched: false,
      workspaceId: workspace.workspace_id,
    };
    const workspaceQueryMatches = queryMatches(queryWords, [
      workspace.workspace_id,
      workspace.label,
      ...Object.values(workspace.tokens),
    ]);
    workspaceRow.matched =
      workspaceQueryMatches && statusMatches(workspaceRow.status, options.filter);

    const workspaceDescendants: NavigatorRow[] = [];
    const tabs = (tabsByWorkspace.get(workspace.workspace_id) ?? []).sort((left, right) =>
      compareNumberThenId(left, right, left.tab_id, right.tab_id),
    );

    for (const tab of tabs) {
      const tabRow: NavigatorRow = {
        key: `tab:${tab.tab_id}`,
        id: tab.tab_id,
        kind: 'tab',
        depth: 1,
        label: tab.label,
        meta: count(tab.pane_count, 'pane'),
        status: tab.agent_status,
        current: snapshot.focused_tab_id === tab.tab_id,
        matched: false,
        workspaceId: workspace.workspace_id,
        tabId: tab.tab_id,
      };
      const tabQueryMatches = queryMatches(queryWords, [tab.tab_id, tab.label]);
      tabRow.matched = tabQueryMatches && statusMatches(tabRow.status, options.filter);

      const paneRows = (panesByTab.get(tab.tab_id) ?? [])
        .sort((left, right) => left.pane_id.localeCompare(right.pane_id))
        .map<NavigatorRow>((pane) => {
          const label =
            pane.label ||
            pane.title ||
            pane.display_agent ||
            pane.terminal_title_stripped ||
            pane.pane_id;
          const meta =
            pane.display_agent ||
            pane.agent ||
            pane.terminal_title_stripped ||
            pane.foreground_cwd ||
            pane.cwd ||
            'Terminal pane';
          const row: NavigatorRow = {
            key: `pane:${pane.pane_id}`,
            id: pane.pane_id,
            kind: 'pane',
            depth: 2,
            label,
            meta,
            status: pane.agent_status,
            current: snapshot.focused_pane_id === pane.pane_id,
            matched: false,
            workspaceId: workspace.workspace_id,
            tabId: tab.tab_id,
          };
          const paneQueryMatches = queryMatches(queryWords, [
            pane.pane_id,
            label,
            meta,
            ...Object.values(pane.tokens),
            ...Object.values(pane.state_labels),
          ]);
          row.matched = paneQueryMatches && statusMatches(row.status, options.filter);
          return row;
        })
        .filter(
          (row) =>
            row.matched ||
            ((workspaceQueryMatches || tabQueryMatches) &&
              statusMatches(row.status, options.filter)),
        );

      const tabIncludedByWorkspace =
        workspaceQueryMatches && statusMatches(tabRow.status, options.filter);
      if (tabRow.matched || tabIncludedByWorkspace || paneRows.length > 0) {
        workspaceDescendants.push(tabRow, ...paneRows);
      }
    }

    if (workspaceRow.matched || workspaceDescendants.length > 0) {
      rows.push(workspaceRow, ...workspaceDescendants);
    }
  }

  return rows;
}

export function moveNavigatorSelection(
  resultCount: number,
  currentIndex: number,
  move: NavigatorMove,
): number {
  if (resultCount === 0) {
    return -1;
  }
  if (move === 'first') {
    return 0;
  }
  if (move === 'last') {
    return resultCount - 1;
  }
  const delta = move === 'next' ? 1 : -1;
  return Math.min(resultCount - 1, Math.max(0, currentIndex + delta));
}
