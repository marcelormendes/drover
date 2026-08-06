import type { AgentInfo, SessionSnapshot, TabInfo, WorkspaceInfo } from '@/shared/herdr';

export interface MobileSwitcherModel {
  spaces: WorkspaceInfo[];
  tabs: TabInfo[];
  agents: AgentInfo[];
  activeWorkspace?: WorkspaceInfo;
  activeTab?: TabInfo;
  attentionCount: number;
  counts: {
    agents: number;
    spaces: number;
    tabs: number;
    attention: number;
  };
}

const compareNumbered = <T extends { number: number }>(
  left: T,
  right: T,
  id: (item: T) => string,
) => left.number - right.number || id(left).localeCompare(id(right), undefined, { numeric: true });

export function buildMobileSwitcherModel(snapshot: SessionSnapshot): MobileSwitcherModel {
  const spaces = [...snapshot.workspaces].sort((left, right) =>
    compareNumbered(left, right, (workspace) => workspace.workspace_id),
  );
  const activeWorkspace =
    spaces.find((workspace) => workspace.workspace_id === snapshot.focused_workspace_id) ??
    spaces.find((workspace) => workspace.focused) ??
    spaces[0];
  const tabs = snapshot.tabs
    .filter((tab) => tab.workspace_id === activeWorkspace?.workspace_id)
    .sort((left, right) => compareNumbered(left, right, (tab) => tab.tab_id));
  const activeTab =
    tabs.find((tab) => tab.tab_id === snapshot.focused_tab_id) ??
    tabs.find((tab) => tab.tab_id === activeWorkspace?.active_tab_id) ??
    tabs.find((tab) => tab.focused) ??
    tabs[0];
  const workspaceOrder = new Map(
    spaces.map((workspace, index) => [workspace.workspace_id, index] as const),
  );
  const orderedTabs = [...snapshot.tabs].sort((left, right) => {
    const byWorkspace =
      (workspaceOrder.get(left.workspace_id) ?? Number.MAX_SAFE_INTEGER) -
      (workspaceOrder.get(right.workspace_id) ?? Number.MAX_SAFE_INTEGER);
    return byWorkspace || compareNumbered(left, right, (tab) => tab.tab_id);
  });
  const tabOrder = new Map(orderedTabs.map((tab, index) => [tab.tab_id, index] as const));
  const agents = [...snapshot.agents].sort((left, right) => {
    const byWorkspace =
      (workspaceOrder.get(left.workspace_id) ?? Number.MAX_SAFE_INTEGER) -
      (workspaceOrder.get(right.workspace_id) ?? Number.MAX_SAFE_INTEGER);
    const byTab =
      (tabOrder.get(left.tab_id) ?? Number.MAX_SAFE_INTEGER) -
      (tabOrder.get(right.tab_id) ?? Number.MAX_SAFE_INTEGER);
    return (
      byWorkspace ||
      byTab ||
      left.pane_id.localeCompare(right.pane_id, undefined, { numeric: true })
    );
  });
  const attentionCount = agents.filter(
    (agent) => agent.agent_status === 'blocked' || agent.agent_status === 'done',
  ).length;

  return {
    spaces,
    tabs,
    agents,
    activeWorkspace,
    activeTab,
    attentionCount,
    counts: {
      agents: agents.length,
      spaces: spaces.length,
      tabs: tabs.length,
      attention: attentionCount,
    },
  };
}
