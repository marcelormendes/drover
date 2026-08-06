import { describe, expect, it } from 'vitest';

import { DEMO_SNAPSHOT, demoQueryResult } from '@/shared/demo';

describe('demoQueryResult', () => {
  it('returns representative agent output for chat preview panes', () => {
    expect(demoQueryResult({ type: 'read-pane-output', paneId: 'w1:p1', lines: 500 })).toEqual({
      type: 'pane-output',
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: expect.stringContaining('chat'),
      revision: 42,
      truncated: false,
    });
  });

  it('rejects non-preview queries instead of inventing engine state', () => {
    expect(() => demoQueryResult({ type: 'list-plugins' })).toThrow(
      'Queries are unavailable in demo mode.',
    );
  });

  it('uses canonical split geometry and agent records for visual verification', () => {
    expect(DEMO_SNAPSHOT.layouts.find((layout) => layout.tab_id === 'w1:t1')).toMatchObject({
      focused_pane_id: 'w1:p1',
      zoomed: false,
      panes: [
        { pane_id: 'w1:p1', rect: { x: 0, y: 0, width: 120, height: 60 } },
        { pane_id: 'w1:p2', rect: { x: 120, y: 0, width: 80, height: 60 } },
      ],
    });
    expect(DEMO_SNAPSHOT.agents.map((agent) => agent.agent_status)).toEqual(
      expect.arrayContaining(['working', 'done', 'idle', 'blocked']),
    );
  });
});
