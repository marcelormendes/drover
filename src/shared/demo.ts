import type { HerdrQuery, HerdrQueryResult } from '@/shared/desktop-api';
import type { EngineBootstrap, PaneInfo, SessionSnapshot } from '@/shared/herdr';

const panes: PaneInfo[] = [
  {
    pane_id: 'w1:p1',
    terminal_id: 'terminal-1',
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: true,
    cwd: '/Users/marcelo/code/herdr-desktop',
    foreground_cwd: '/Users/marcelo/code/herdr-desktop',
    label: 'Desktop implementation',
    agent: 'codex',
    display_agent: 'Codex',
    agent_status: 'working',
    state_labels: { working: 'Implementing session shell' },
    tokens: { branch: 'feat/desktop-ui' },
    revision: 42,
  },
  {
    pane_id: 'w1:p2',
    terminal_id: 'terminal-2',
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: false,
    cwd: '/Users/marcelo/code/herdr-desktop',
    label: 'Engine contract tests',
    agent: 'claude',
    display_agent: 'Claude',
    agent_status: 'done',
    state_labels: { done: 'Adapter tests passed' },
    tokens: {},
    revision: 18,
  },
  {
    pane_id: 'w1:p3',
    terminal_id: 'terminal-3',
    workspace_id: 'w1',
    tab_id: 'w1:t2',
    focused: false,
    cwd: '/Users/marcelo/code/herdr-desktop',
    label: 'Architecture notes',
    agent_status: 'idle',
    state_labels: {},
    tokens: {},
    revision: 7,
  },
  {
    pane_id: 'w2:p1',
    terminal_id: 'terminal-4',
    workspace_id: 'w2',
    tab_id: 'w2:t1',
    focused: false,
    cwd: '/Users/marcelo/code/neobrutalism-components',
    label: 'Component audit',
    agent: 'codex',
    display_agent: 'Codex',
    agent_status: 'idle',
    state_labels: { idle: 'Waiting for input' },
    tokens: {},
    revision: 11,
  },
  {
    pane_id: 'w3:p1',
    terminal_id: 'terminal-5',
    workspace_id: 'w3',
    tab_id: 'w3:t1',
    focused: false,
    cwd: '/Users/marcelo/code/herdr-desktop',
    label: 'Release checklist',
    agent: 'gemini',
    display_agent: 'Gemini',
    agent_status: 'blocked',
    state_labels: { blocked: 'Approval needed' },
    tokens: {},
    revision: 23,
  },
];

export const DEMO_SNAPSHOT: SessionSnapshot = {
  version: '0.8.0',
  protocol: 7,
  focused_workspace_id: 'w1',
  focused_tab_id: 'w1:t1',
  focused_pane_id: 'w1:p1',
  workspaces: [
    {
      workspace_id: 'w1',
      number: 1,
      label: 'herdr-desktop',
      focused: true,
      pane_count: 3,
      tab_count: 2,
      active_tab_id: 'w1:t1',
      agent_status: 'working',
      tokens: { branch: 'feat/desktop-ui' },
      worktree: {
        repo_key: 'github.com/herdrdev/herdr-desktop',
        repo_name: 'herdr-desktop',
        repo_root: '/Users/marcelo/code/herdr-desktop',
        checkout_path: '/Users/marcelo/code/herdr-desktop',
        is_linked_worktree: false,
      },
    },
    {
      workspace_id: 'w2',
      number: 2,
      label: 'neobrutalism-v4',
      focused: false,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: 'w2:t1',
      agent_status: 'idle',
      tokens: {},
    },
    {
      workspace_id: 'w3',
      number: 3,
      label: 'release',
      focused: false,
      pane_count: 1,
      tab_count: 1,
      active_tab_id: 'w3:t1',
      agent_status: 'blocked',
      tokens: {},
    },
  ],
  tabs: [
    {
      tab_id: 'w1:t1',
      workspace_id: 'w1',
      number: 1,
      label: 'implementation',
      focused: true,
      pane_count: 2,
      agent_status: 'working',
    },
    {
      tab_id: 'w1:t2',
      workspace_id: 'w1',
      number: 2,
      label: 'research',
      focused: false,
      pane_count: 1,
      agent_status: 'idle',
    },
    {
      tab_id: 'w2:t1',
      workspace_id: 'w2',
      number: 1,
      label: 'components',
      focused: false,
      pane_count: 1,
      agent_status: 'idle',
    },
    {
      tab_id: 'w3:t1',
      workspace_id: 'w3',
      number: 1,
      label: 'ship',
      focused: false,
      pane_count: 1,
      agent_status: 'blocked',
    },
  ],
  panes,
  layouts: [
    {
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      zoomed: false,
      area: { x: 0, y: 0, width: 200, height: 60 },
      focused_pane_id: 'w1:p1',
      panes: [
        {
          pane_id: 'w1:p1',
          focused: true,
          rect: { x: 0, y: 0, width: 120, height: 60 },
        },
        {
          pane_id: 'w1:p2',
          focused: false,
          rect: { x: 120, y: 0, width: 80, height: 60 },
        },
      ],
      splits: [
        {
          id: 'split_root',
          direction: 'right',
          ratio: 0.6,
          rect: { x: 0, y: 0, width: 200, height: 60 },
        },
      ],
    },
  ],
  agents: panes
    .filter((pane) => pane.agent)
    .map((pane, index) => ({
      terminal_id: pane.terminal_id,
      name: ['builder', 'tester', 'designer', 'release-reviewer'][index],
      agent: pane.agent,
      display_agent: pane.display_agent,
      agent_status: pane.agent_status,
      screen_detection_skipped: false,
      state_labels: pane.state_labels,
      tokens: pane.tokens,
      workspace_id: pane.workspace_id,
      tab_id: pane.tab_id,
      pane_id: pane.pane_id,
      focused: pane.focused,
      launch_pending: false,
      interactive_ready: true,
      state_change_seq: pane.revision,
      cwd: pane.cwd,
      foreground_cwd: pane.foreground_cwd,
      revision: pane.revision,
    })),
};

export const DEMO_BOOTSTRAP: EngineBootstrap = {
  state: 'connected',
  status: {
    client: {
      version: '0.8.0',
      channel: 'stable',
      protocol: 7,
      binary: '/usr/local/bin/herdr',
      session: 'desktop-preview',
    },
    server: {
      status: 'running',
      running: true,
      version: '0.8.0',
      protocol: 7,
      capabilities: { live_handoff: true, detached_server_daemon: true },
      compatible: true,
      socket: '/tmp/herdr-preview.sock',
      session: 'desktop-preview',
      restart_needed: false,
    },
    update: { restart_needed: false },
  },
  snapshot: DEMO_SNAPSHOT,
};

const DEMO_OUTPUT: Record<string, string> = {
  'w1:p1': `The chat surface is connected to Herdr's public pane output.

I am implementing the default agent conversation view now. The terminal remains available as a fallback for approvals and advanced controls.`,
  'w1:p2': `Engine contract tests passed.

The desktop reads plain, unwrapped pane output through Herdr without taking ownership of the agent process.`,
  'w2:p1': `Component audit complete.

The message cards, status treatment, composer, and view switch follow the same neobrutalist design language as the rest of the desktop.`,
  'w3:p1': `Approval needed.

Open the terminal fallback to inspect and answer the agent's interactive prompt.`,
};

export function demoQueryResult(query: HerdrQuery): HerdrQueryResult {
  if (query.type !== 'read-pane-output') {
    throw new Error('Queries are unavailable in demo mode.');
  }
  const pane = DEMO_SNAPSHOT.panes.find((item) => item.pane_id === query.paneId);
  if (!pane) {
    throw new Error('Demo pane is unavailable.');
  }
  return {
    type: 'pane-output',
    paneId: pane.pane_id,
    workspaceId: pane.workspace_id,
    tabId: pane.tab_id,
    text: DEMO_OUTPUT[pane.pane_id] || 'This pane has no agent conversation yet.',
    revision: pane.revision,
    truncated: false,
  };
}
