import { describe, expect, it } from 'vitest';

import {
  orderTabs,
  orderWorkspaces,
  planTabMove,
  planWorkspaceMove,
} from '@/renderer/navigation/reorder-model';
import type { TabInfo, WorkspaceInfo } from '@/shared/herdr';

const workspaces: WorkspaceInfo[] = [
  {
    workspace_id: 'w3',
    number: 3,
    label: 'Three',
    focused: false,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: 't3',
    agent_status: 'idle',
    tokens: {},
  },
  {
    workspace_id: 'w1',
    number: 1,
    label: 'One',
    focused: true,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: 't1',
    agent_status: 'idle',
    tokens: {},
  },
  {
    workspace_id: 'w2',
    number: 2,
    label: 'Two',
    focused: false,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: 't2',
    agent_status: 'idle',
    tokens: {},
  },
];

const tabs: TabInfo[] = [
  {
    tab_id: 't2',
    workspace_id: 'w1',
    number: 2,
    label: 'Two',
    focused: false,
    pane_count: 1,
    agent_status: 'idle',
  },
  {
    tab_id: 'foreign',
    workspace_id: 'w2',
    number: 1,
    label: 'Foreign',
    focused: false,
    pane_count: 1,
    agent_status: 'idle',
  },
  {
    tab_id: 't1',
    workspace_id: 'w1',
    number: 1,
    label: 'One',
    focused: true,
    pane_count: 1,
    agent_status: 'idle',
  },
];

describe('reorder models', () => {
  it('orders canonical records by their engine number without mutating input', () => {
    expect(orderWorkspaces(workspaces).map((workspace) => workspace.workspace_id)).toEqual([
      'w1',
      'w2',
      'w3',
    ]);
    expect(orderTabs(tabs, 'w1').map((tab) => tab.tab_id)).toEqual(['t1', 't2']);
    expect(workspaces[0]?.workspace_id).toBe('w3');
  });

  it('plans workspace and tab moves as canonical ids plus insert indices', () => {
    expect(planWorkspaceMove(workspaces, 'w2', 'up')).toEqual({
      workspaceId: 'w2',
      insertIndex: 0,
    });
    expect(planWorkspaceMove(workspaces, 'w3', 'down')).toBeNull();
    expect(planTabMove(tabs, 'w1', 't1', 'down')).toEqual({ tabId: 't1', insertIndex: 1 });
    expect(planTabMove(tabs, 'w1', 'foreign', 'up')).toBeNull();
  });
});
