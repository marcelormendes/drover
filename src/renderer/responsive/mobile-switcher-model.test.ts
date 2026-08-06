import { describe, expect, it } from 'vitest';

import { buildMobileSwitcherModel } from '@/renderer/responsive/mobile-switcher-model';
import { snapshot } from '@/renderer/responsive/test-fixtures';

describe('buildMobileSwitcherModel', () => {
  it('derives deterministic sections from canonical snapshot ordering', () => {
    const model = buildMobileSwitcherModel(snapshot);

    expect(model.spaces.map((workspace) => workspace.workspace_id)).toEqual(['w1', 'w2']);
    expect(model.tabs.map((tab) => tab.tab_id)).toEqual(['t1', 't2']);
    expect(model.agents.map((item) => item.pane_id)).toEqual(['p1', 'p2']);
    expect(model.activeWorkspace?.workspace_id).toBe('w1');
    expect(model.activeTab?.tab_id).toBe('t1');
  });

  it('counts blocked and unseen-done agents as attention without duplicating pane state', () => {
    const model = buildMobileSwitcherModel(snapshot);

    expect(model.attentionCount).toBe(2);
    expect(model.counts).toEqual({ agents: 2, spaces: 2, tabs: 2, attention: 2 });
  });
});
