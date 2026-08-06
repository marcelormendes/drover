import { describe, expect, it } from 'vitest';

import {
  buildNavigatorRows,
  moveNavigatorSelection,
  type NavigatorFilter,
} from '@/renderer/navigation/navigator-model';
import type { SessionSnapshot } from '@/shared/herdr';

const snapshot: SessionSnapshot = {
  version: '0.8.0',
  protocol: 7,
  focused_workspace_id: 'w1',
  focused_tab_id: 't1',
  focused_pane_id: 'p2',
  workspaces: [
    {
      workspace_id: 'w2',
      number: 2,
      label: 'Docs',
      focused: false,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: 't2',
      agent_status: 'idle',
      tokens: {},
    },
    {
      workspace_id: 'w1',
      number: 1,
      label: 'Desktop',
      focused: true,
      pane_count: 2,
      tab_count: 1,
      active_tab_id: 't1',
      agent_status: 'blocked',
      tokens: {},
    },
  ],
  tabs: [
    {
      tab_id: 't2',
      workspace_id: 'w2',
      number: 1,
      label: 'Guide',
      focused: false,
      pane_count: 1,
      agent_status: 'idle',
    },
    {
      tab_id: 't1',
      workspace_id: 'w1',
      number: 1,
      label: 'Implementation',
      focused: true,
      pane_count: 2,
      agent_status: 'blocked',
    },
  ],
  panes: [
    {
      pane_id: 'p2',
      terminal_id: 'term-2',
      workspace_id: 'w1',
      tab_id: 't1',
      focused: true,
      label: 'Reviewer',
      display_agent: 'Codex',
      agent_status: 'blocked',
      state_labels: {},
      tokens: {},
      revision: 2,
    },
    {
      pane_id: 'p1',
      terminal_id: 'term-1',
      workspace_id: 'w1',
      tab_id: 't1',
      focused: false,
      label: 'Server',
      agent_status: 'working',
      state_labels: {},
      tokens: {},
      revision: 1,
    },
    {
      pane_id: 'p3',
      terminal_id: 'term-3',
      workspace_id: 'w2',
      tab_id: 't2',
      focused: false,
      label: 'Editor',
      agent_status: 'idle',
      state_labels: {},
      tokens: {},
      revision: 1,
    },
  ],
  layouts: [],
  agents: [],
};

describe('buildNavigatorRows', () => {
  it('builds a deterministic workspace, tab, and pane hierarchy from the snapshot', () => {
    const rows = buildNavigatorRows(snapshot, { filter: 'all', query: '' });

    expect(rows.map(({ id, kind, depth }) => ({ id, kind, depth }))).toEqual([
      { id: 'w1', kind: 'workspace', depth: 0 },
      { id: 't1', kind: 'tab', depth: 1 },
      { id: 'p1', kind: 'pane', depth: 2 },
      { id: 'p2', kind: 'pane', depth: 2 },
      { id: 'w2', kind: 'workspace', depth: 0 },
      { id: 't2', kind: 'tab', depth: 1 },
      { id: 'p3', kind: 'pane', depth: 2 },
    ]);
    expect(rows.find((row) => row.id === 'p2')).toMatchObject({
      current: true,
      label: 'Reviewer',
      meta: 'Codex',
      status: 'blocked',
    });
  });

  it('keeps ancestor context when a descendant matches the query', () => {
    const rows = buildNavigatorRows(snapshot, { filter: 'all', query: 'reviewer codex' });

    expect(rows.map((row) => row.id)).toEqual(['w1', 't1', 'p2']);
    expect(rows.map((row) => row.matched)).toEqual([false, false, true]);
  });

  it('keeps a matched workspace subtree available for keyboard navigation', () => {
    const rows = buildNavigatorRows(snapshot, { filter: 'all', query: 'Desktop' });

    expect(rows.map((row) => row.id)).toEqual(['w1', 't1', 'p1', 'p2']);
    expect(rows.map((row) => row.matched)).toEqual([true, false, false, false]);
  });

  it('keeps a matched tab subtree available with its workspace context', () => {
    const rows = buildNavigatorRows(snapshot, { filter: 'all', query: 'Implementation' });

    expect(rows.map((row) => row.id)).toEqual(['w1', 't1', 'p1', 'p2']);
    expect(rows.map((row) => row.matched)).toEqual([false, true, false, false]);
  });

  it.each<NavigatorFilter>(['blocked', 'working', 'idle', 'done'])(
    'filters rows by the engine-owned %s status while retaining ancestors',
    (filter) => {
      const rows = buildNavigatorRows(snapshot, { filter, query: '' });

      if (filter === 'blocked') {
        expect(rows.map((row) => row.id)).toEqual(['w1', 't1', 'p2']);
      } else if (filter === 'working') {
        expect(rows.map((row) => row.id)).toEqual(['w1', 't1', 'p1']);
      } else if (filter === 'idle') {
        expect(rows.map((row) => row.id)).toEqual(['w2', 't2', 'p3']);
      } else {
        expect(rows).toEqual([]);
      }
    },
  );
});

describe('moveNavigatorSelection', () => {
  it('clamps keyboard movement to the available result range', () => {
    expect(moveNavigatorSelection(3, 0, 'previous')).toBe(0);
    expect(moveNavigatorSelection(3, 1, 'next')).toBe(2);
    expect(moveNavigatorSelection(3, 2, 'next')).toBe(2);
    expect(moveNavigatorSelection(3, 2, 'first')).toBe(0);
    expect(moveNavigatorSelection(3, 0, 'last')).toBe(2);
    expect(moveNavigatorSelection(0, 0, 'next')).toBe(-1);
  });
});
