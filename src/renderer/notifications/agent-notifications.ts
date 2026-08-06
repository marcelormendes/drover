import type { AgentInfo } from '@/shared/herdr';

export interface AgentNotification {
  paneId: string;
  title: string;
  description: string;
}

function displayName(agent: AgentInfo): string {
  return agent.name || agent.display_agent || agent.agent || agent.pane_id;
}

export function agentNotifications(
  previous: AgentInfo[],
  current: AgentInfo[],
  focusedPaneId: string | undefined,
): AgentNotification[] {
  if (previous.length === 0) {
    return [];
  }

  const previousByPane = new Map(previous.map((agent) => [agent.pane_id, agent]));
  const notifications: AgentNotification[] = [];
  for (const agent of current) {
    const before = previousByPane.get(agent.pane_id);
    if (
      !before ||
      agent.pane_id === focusedPaneId ||
      agent.state_change_seq <= before.state_change_seq ||
      agent.agent_status === before.agent_status ||
      (agent.agent_status !== 'blocked' && agent.agent_status !== 'done')
    ) {
      continue;
    }
    const name = displayName(agent);
    notifications.push({
      paneId: agent.pane_id,
      title: agent.agent_status === 'done' ? `${name} finished` : `${name} needs attention`,
      description: `Agent status changed to ${agent.agent_status}.`,
    });
  }
  return notifications;
}
