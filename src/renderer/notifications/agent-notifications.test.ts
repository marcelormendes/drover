import { describe, expect, it } from 'vitest';

import { agentNotifications } from '@/renderer/notifications/agent-notifications';
import type { AgentInfo } from '@/shared/herdr';

function agent(status: AgentInfo['agent_status'], sequence: number): AgentInfo {
  return {
    pane_id: 'w1:p1',
    terminal_id: 'terminal-1',
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: false,
    name: 'reviewer',
    display_agent: 'Codex',
    agent_status: status,
    state_labels: {},
    tokens: {},
    revision: sequence,
    screen_detection_skipped: false,
    launch_pending: false,
    interactive_ready: true,
    state_change_seq: sequence,
  };
}

describe('agentNotifications', () => {
  it('emits actionable attention transitions only for background agents', () => {
    const previous = [agent('working', 1)];
    const blocked = agent('blocked', 2);

    expect(agentNotifications(previous, [blocked], 'w1:p2')).toEqual([
      {
        paneId: 'w1:p1',
        title: 'reviewer needs attention',
        description: 'Agent status changed to blocked.',
      },
    ]);
    expect(agentNotifications(previous, [blocked], 'w1:p1')).toEqual([]);
  });

  it('does not duplicate unchanged state or announce initial snapshot hydration', () => {
    const done = agent('done', 3);

    expect(agentNotifications([], [done], undefined)).toEqual([]);
    expect(agentNotifications([done], [done], undefined)).toEqual([]);
  });
});
