import { describe, expect, it } from 'vitest';

import { decodeSessionSnapshot } from '@/main/herdr/snapshot-decoder';

/**
 * Released-Desktop decoder compatibility: the capable engine omits the legacy
 * `agent_session` field for path-backed sessions and adds an opaque
 * `conversation_session`/`conversation_capability` that released Desktop
 * versions must ignore. Legacy engines keep `agent_session` with
 * `kind: "path"`/`kind: "id"`, which the decoder must still accept for
 * Terminal mode.
 */
function baseSnapshot(agentSession: unknown, conversation: unknown): unknown {
  return {
    version: '0.8.0',
    protocol: 20,
    focused_workspace_id: 'w1',
    focused_tab_id: 'w1:t1',
    focused_pane_id: 'w1:p1',
    workspaces: [],
    tabs: [],
    panes: [
      {
        pane_id: 'w1:p1',
        terminal_id: 'terminal-1',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        focused: true,
        cwd: '/tmp',
        agent: 'pi',
        title: 'pi',
        terminal_title: 'pi',
        terminal_title_stripped: 'pi',
        display_agent: 'pi',
        agent_status: 'working',
        state_labels: {},
        tokens: {},
        agent_session: agentSession,
        ...(conversation as Record<string, unknown>),
        scroll: { offset_from_bottom: 0, max_offset_from_bottom: 0, viewport_rows: 24 },
        revision: 1,
      },
    ],
    layouts: [],
    agents: [],
  };
}

describe('released Desktop decoder vs capable engine snapshots', () => {
  it('decodes a capable-engine snapshot where path-backed sessions omit agent_session', () => {
    const snapshot = baseSnapshot(undefined, {
      conversation_session: { id: 'opaque-random-handle' },
      conversation_capability: {
        availability: 'supported',
        reason: 'ready',
      },
    });
    const decoded = decodeSessionSnapshot(snapshot);
    expect(decoded).not.toBeNull();
    expect(decoded?.panes[0].agent_session).toBeUndefined();
  });

  it('still decodes legacy path-kind agent_session for Terminal compatibility', () => {
    const snapshot = baseSnapshot(
      { source: 'herdr:pi', agent: 'pi', kind: 'path', value: '/home/u/.pi/s.jsonl' },
      undefined,
    );
    const decoded = decodeSessionSnapshot(snapshot);
    expect(decoded).not.toBeNull();
    expect(decoded?.panes[0].agent_session).toEqual({
      source: 'herdr:pi',
      agent: 'pi',
      kind: 'path',
      value: '/home/u/.pi/s.jsonl',
    });
  });

  it('still decodes id-kind agent_session (safe opaque provider ids)', () => {
    const snapshot = baseSnapshot(
      { source: 'herdr:claude', agent: 'claude', kind: 'id', value: 'thread-1' },
      undefined,
    );
    const decoded = decodeSessionSnapshot(snapshot);
    expect(decoded).not.toBeNull();
    expect(decoded?.panes[0].agent_session?.kind).toBe('id');
  });
});
