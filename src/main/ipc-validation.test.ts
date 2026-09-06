import { describe, expect, it } from 'vitest';
import {
  parseConversationPromptRequest,
  parseConversationReadRequest,
  parseConversationRespondRequest,
  parseHerdrCommand,
  parseHerdrQuery,
  parsePaneId,
  parseRemoteEngineTarget,
  parseTerminalInput,
  parseTerminalOpen,
  parseTerminalResize,
  parseTerminalScroll,
} from '@/main/ipc-validation';

describe('IPC validation', () => {
  it('accepts the finite Herdr command contract', () => {
    expect(parseHerdrCommand({ type: 'focus-pane', paneId: 'w1:p2' })).toEqual({
      type: 'focus-pane',
      paneId: 'w1:p2',
    });
    expect(
      parseHerdrCommand({
        type: 'create-workspace',
        cwd: '/code/herdr',
        label: 'Desktop',
      }),
    ).toEqual({
      type: 'create-workspace',
      cwd: '/code/herdr',
      label: 'Desktop',
    });
    expect(parseHerdrCommand({ type: 'split-pane', paneId: 'w1:p1', direction: 'down' })).toEqual({
      type: 'split-pane',
      paneId: 'w1:p1',
      direction: 'down',
    });
    expect(
      parseHerdrCommand({ type: 'rename-workspace', workspaceId: 'w1', label: 'Desktop' }),
    ).toEqual({ type: 'rename-workspace', workspaceId: 'w1', label: 'Desktop' });
    expect(
      parseHerdrCommand({ type: 'start-agent', paneId: 'w1:p1', name: 'reviewer', kind: 'codex' }),
    ).toEqual({ type: 'start-agent', paneId: 'w1:p1', name: 'reviewer', kind: 'codex' });
    expect(
      parseHerdrCommand({
        type: 'start-agent',
        paneId: 'w1:p1',
        name: 'reviewer',
        kind: 'codex',
        args: ['--full-auto'],
        timeoutMs: 45_000,
      }),
    ).toEqual({
      type: 'start-agent',
      paneId: 'w1:p1',
      name: 'reviewer',
      kind: 'codex',
      args: ['--full-auto'],
      timeoutMs: 45_000,
    });
  });

  it('rejects unknown commands and malformed identifiers', () => {
    expect(() => parseHerdrCommand({ type: 'server.delete-everything' })).toThrow(
      'Invalid Herdr command.',
    );
    expect(() => parseHerdrCommand({ type: 'focus-pane', paneId: '../socket' })).toThrow(
      'Invalid Herdr command.',
    );
    expect(() =>
      parseHerdrCommand({ type: 'start-agent', paneId: 'w1:p1', name: 'Bad Name', kind: 'codex' }),
    ).toThrow('Invalid Herdr command.');
    expect(() =>
      parseHerdrCommand({
        type: 'start-agent',
        paneId: 'w1:p1',
        name: 'reviewer',
        kind: 'unknown',
      }),
    ).toThrow('Invalid Herdr command.');
  });

  it('accepts Herdr public identifiers after their counters pass nine', () => {
    expect(parseHerdrCommand({ type: 'focus-workspace', workspaceId: 'wA' })).toEqual({
      type: 'focus-workspace',
      workspaceId: 'wA',
    });
    expect(parseHerdrCommand({ type: 'focus-tab', tabId: 'wA:tZ' })).toEqual({
      type: 'focus-tab',
      tabId: 'wA:tZ',
    });
    expect(parseHerdrCommand({ type: 'focus-pane', paneId: 'w2:pA' })).toEqual({
      type: 'focus-pane',
      paneId: 'w2:pA',
    });
    expect(
      parseHerdrQuery({ type: 'read-pane-output', paneId: 'w1:p2', source: 'visible' }),
    ).toEqual({
      type: 'read-pane-output',
      paneId: 'w1:p2',
      source: 'visible',
    });
    expect(() =>
      parseHerdrQuery({ type: 'read-pane-output', paneId: 'w1:p2', source: 'history' }),
    ).toThrow();
    expect(parseHerdrQuery({ type: 'read-pane-output', paneId: 'wA:p11' })).toEqual({
      type: 'read-pane-output',
      paneId: 'wA:p11',
    });
  });

  it('accepts only finite typed Herdr queries', () => {
    expect(parseHerdrQuery({ type: 'list-worktrees', workspaceId: 'w1' })).toEqual({
      type: 'list-worktrees',
      workspaceId: 'w1',
    });
    expect(parseHerdrQuery({ type: 'get-agent-manifests' })).toEqual({
      type: 'get-agent-manifests',
    });
    expect(parseHerdrQuery({ type: 'list-plugins', pluginId: 'example.review' })).toEqual({
      type: 'list-plugins',
      pluginId: 'example.review',
    });
    expect(parseHerdrQuery({ type: 'list-plugin-actions' })).toEqual({
      type: 'list-plugin-actions',
    });
    expect(parseHerdrQuery({ type: 'read-pane-output', paneId: 'w1:p2', lines: 500 })).toEqual({
      type: 'read-pane-output',
      paneId: 'w1:p2',
      lines: 500,
    });
    expect(() => parseHerdrQuery({ type: 'api.arbitrary', method: 'server.stop' })).toThrow(
      'Invalid Herdr query.',
    );
    expect(() => parseHerdrQuery({ type: 'list-worktrees', workspaceId: '../socket' })).toThrow(
      'Invalid Herdr query.',
    );
    expect(() =>
      parseHerdrQuery({ type: 'read-pane-output', paneId: '../socket', lines: 500 }),
    ).toThrow('Invalid Herdr query.');
    expect(() => parseHerdrQuery({ type: 'read-pane-output', paneId: 'w1:p2', lines: 0 })).toThrow(
      'Invalid Herdr query.',
    );
  });

  it.each([
    ['workspace ordering', { type: 'move-workspace', workspaceId: 'w2', insertIndex: 0 }],
    [
      'workspace block ordering',
      {
        type: 'move-workspace-block',
        workspaceIds: ['w2', 'w3'],
        beforeWorkspaceId: 'w1',
      },
    ],
    [
      'worktree creation',
      {
        type: 'create-worktree',
        workspaceId: 'w1',
        cwd: '/code/herdr',
        branch: 'feature/desktop',
        base: 'main',
        path: '/code/worktrees/desktop',
        label: 'desktop',
        focus: true,
      },
    ],
    [
      'worktree opening',
      {
        type: 'open-worktree',
        workspaceId: 'w1',
        cwd: '/code/herdr',
        branch: 'feature/desktop',
        label: 'desktop',
        focus: false,
      },
    ],
    ['worktree removal', { type: 'remove-worktree', workspaceId: 'w2', force: true }],
    ['tab ordering', { type: 'move-tab', tabId: 'w1:t2', insertIndex: 0 }],
    ['directional pane swapping', { type: 'swap-pane', paneId: 'w1:p1', direction: 'left' }],
    ['explicit pane swapping', { type: 'swap-pane', sourcePaneId: 'w1:p1', targetPaneId: 'w1:p2' }],
    [
      'pane movement',
      {
        type: 'move-pane',
        paneId: 'w1:p2',
        destination: {
          type: 'tab',
          tabId: 'w2:t1',
          targetPaneId: 'w2:p1',
          split: 'right',
          ratio: 0.4,
        },
        focus: true,
      },
    ],
    [
      'directional pane focus',
      { type: 'focus-pane-direction', paneId: 'w1:p1', direction: 'down' },
    ],
    ['pane resizing', { type: 'resize-pane', paneId: 'w1:p1', direction: 'right', amount: 0.1 }],
    [
      'pane resizing with engine default',
      { type: 'resize-pane', paneId: 'w1:p1', direction: 'right' },
    ],
    [
      'split ratio changes',
      { type: 'set-split-ratio', tabId: 'w1:t1', path: [false, true], ratio: 0.6 },
    ],
    ['agent renaming', { type: 'rename-agent', target: 'reviewer', name: 'reviewer-2' }],
    ['agent name clearing', { type: 'rename-agent', target: 'reviewer' }],
    [
      'agent prompting',
      {
        type: 'prompt-agent',
        target: 'reviewer',
        text: 'Review the change',
        wait: { until: ['done', 'blocked'], timeoutMs: 60_000 },
      },
    ],
    [
      'agent slash-command pane input',
      { type: 'send-pane-input', paneId: 'w1:p1', text: '/compact', keys: ['enter'] },
    ],
    [
      'agent view selection',
      {
        type: 'set-agent-view',
        source: 'desktop',
        label: 'Needs attention',
        filter: { op: 'in', field: 'status', values: ['blocked', 'done'] },
        sort: [{ field: 'attention', order: 'desc' }],
      },
    ],
    ['agent view clearing', { type: 'clear-agent-view', source: 'desktop' }],
    ['agent view reset', { type: 'clear-agent-view' }],
    ['unfiltered agent view', { type: 'set-agent-view', source: 'desktop' }],
    ['integration installation', { type: 'install-integration', target: 'codex' }],
    ['integration removal', { type: 'uninstall-integration', target: 'codex' }],
    ['server config reload', { type: 'reload-server-config' }],
    ['server stop', { type: 'stop-server' }],
    ['server live handoff defaults', { type: 'live-handoff-server' }],
    [
      'server live handoff',
      {
        type: 'live-handoff-server',
        importExe: '/opt/herdr/herdr',
        expectedProtocol: 19,
        expectedVersion: '0.8.0',
      },
    ],
    ['agent manifest reload', { type: 'reload-agent-manifests' }],
    [
      'plugin action invocation',
      {
        type: 'invoke-plugin-action',
        actionId: 'review',
        pluginId: 'example.review',
        context: {
          workspaceId: 'w1',
          selectedText: 'const answer = 42;',
          invocationSource: 'desktop',
        },
      },
    ],
    [
      'plugin pane opening',
      {
        type: 'open-plugin-pane',
        pluginId: 'example.review',
        entrypoint: 'dashboard',
        placement: 'split',
        workspaceId: 'w1',
        targetPaneId: 'w1:p1',
        direction: 'right',
        width: '80%',
        height: 30,
        cwd: '/code/herdr',
        focus: true,
        env: { REVIEW_MODE: 'strict' },
      },
    ],
    ['plugin pane focusing', { type: 'focus-plugin-pane', paneId: 'w1:p2' }],
    ['plugin pane closing', { type: 'close-plugin-pane', paneId: 'w1:p2' }],
    ['plugin enabling', { type: 'enable-plugin', pluginId: 'example.review' }],
    ['plugin disabling', { type: 'disable-plugin', pluginId: 'example.review' }],
  ])('accepts %s commands', (_label, command) => {
    expect(parseHerdrCommand(command)).toEqual(command);
  });

  it.each([
    { type: 'move-workspace', workspaceId: 'w1', insertIndex: -1 },
    { type: 'move-workspace-block', workspaceIds: ['w1', 'w1'] },
    { type: 'move-tab', tabId: 'w1:t1', insertIndex: 1.5 },
    { type: 'swap-pane', paneId: 'w1:p1', direction: 'diagonal' },
    {
      type: 'move-pane',
      paneId: 'w1:p1',
      destination: { type: 'tab', tabId: 'w1:t1', split: 'left' },
    },
    { type: 'resize-pane', paneId: 'w1:p1', direction: 'right', amount: 2 },
    { type: 'set-split-ratio', tabId: 'w1:t1', path: [false, 'left'], ratio: 0.5 },
    { type: 'prompt-agent', target: 'reviewer', text: '', wait: { until: ['finished'] } },
    { type: 'send-pane-input', paneId: 'w1:p1' },
    { type: 'send-pane-input', paneId: 'w1:p1', keys: [] },
    { type: 'send-pane-input', paneId: 'w1:p1', text: '/ok', keys: ['enter', 42] },
    { type: 'send-pane-input', paneId: 'not a pane', text: '/ok' },
    {
      type: 'set-agent-view',
      source: 'desktop',
      filter: { op: 'eq', field: 'status', value: { arbitrary: true } },
    },
    { type: 'install-integration', target: 'unknown' },
    { type: 'live-handoff-server', expectedProtocol: 0 },
    { type: 'open-plugin-pane', pluginId: '', entrypoint: 'dashboard' },
    { type: 'start-agent', paneId: 'w1:p1', name: 'reviewer', kind: 'codex', args: [42] },
    { type: 'start-agent', paneId: 'w1:p1', name: 'reviewer', kind: 'codex', timeoutMs: 3_000 },
    { type: 'enable-plugin', pluginId: '' },
  ])('rejects unsafe parity command %#', (command) => {
    expect(() => parseHerdrCommand(command)).toThrow('Invalid Herdr command.');
  });

  it('bounds terminal attachment and resize dimensions', () => {
    expect(parseTerminalOpen({ paneId: 'w12:p8', cols: 120, rows: 40 })).toEqual({
      paneId: 'w12:p8',
      cols: 120,
      rows: 40,
    });
    expect(
      parseTerminalResize({
        paneId: 'w1:p1',
        cols: 100,
        rows: 32,
        cellWidthPx: 8,
        cellHeightPx: 16,
      }),
    ).toEqual({
      paneId: 'w1:p1',
      cols: 100,
      rows: 32,
      cellWidthPx: 8,
      cellHeightPx: 16,
    });
    expect(() => parseTerminalOpen({ paneId: 'w1:p1', cols: 0, rows: 24 })).toThrow(
      'Invalid terminal dimensions.',
    );
    expect(() => parseTerminalOpen({ paneId: 'pane-1', cols: 80, rows: 24 })).toThrow(
      'Invalid terminal pane identifier.',
    );
    expect(() => parseTerminalResize({ paneId: 'w1:p1', cols: 10_000, rows: 24 })).toThrow(
      'Invalid terminal resize.',
    );
  });

  it('accepts encoded pane identifiers throughout terminal control', () => {
    expect(parseTerminalOpen({ paneId: 'w2:pA', cols: 120, rows: 40 })).toEqual({
      paneId: 'w2:pA',
      cols: 120,
      rows: 40,
    });
    expect(parseTerminalResize({ paneId: 'w2:pA', cols: 100, rows: 32 })).toEqual({
      paneId: 'w2:pA',
      cols: 100,
      rows: 32,
    });
    expect(parseTerminalInput({ paneId: 'w2:pA', text: 'pwd\n' })).toEqual({
      paneId: 'w2:pA',
      text: 'pwd\n',
    });
    expect(
      parseTerminalScroll({ paneId: 'w2:pA', direction: 'up', lines: 3, source: 'wheel' }),
    ).toEqual({ paneId: 'w2:pA', direction: 'up', lines: 3, source: 'wheel' });
    expect(parsePaneId('w2:pA')).toBe('w2:pA');
  });

  it('validates structured conversation requests without accepting paths', () => {
    expect(
      parseConversationReadRequest({
        target: 'w1:p1',
        direction: 'newer',
        cursor: 'cursor-1',
        limit: 64,
      }),
    ).toEqual({ target: 'w1:p1', direction: 'newer', cursor: 'cursor-1', limit: 64 });
    expect(
      parseConversationPromptRequest({
        target: 'w1:p1',
        text: 'hello',
        attachments: [{ handle: 'att-1' }],
      }),
    ).toEqual({ target: 'w1:p1', text: 'hello', attachments: [{ handle: 'att-1' }] });
    expect(
      parseConversationRespondRequest({
        target: 'w1:p1',
        reader_generation: 'generation-1',
        session: { id: 'session-1' },
        request_id: 'approval-1',
        decision_id: 'allow',
      }),
    ).toEqual({
      target: 'w1:p1',
      reader_generation: 'generation-1',
      session: { id: 'session-1' },
      request_id: 'approval-1',
      decision_id: 'allow',
    });
    expect(() => parseConversationReadRequest({ target: 'w1:p1', cursor: '/tmp/file' })).toThrow(
      'Invalid conversation read request.',
    );
    expect(() =>
      parseConversationRespondRequest({
        target: 'w1:p1',
        reader_generation: 'generation-1',
        session: { id: '/tmp/session' },
        request_id: 'approval-1',
        decision_id: 'allow',
      }),
    ).toThrow('Invalid conversation response request.');
  });

  it('accepts normal terminal input and rejects oversized payloads', () => {
    expect(parseTerminalInput({ paneId: 'w1:p1', text: 'npm test\n' })).toEqual({
      paneId: 'w1:p1',
      text: 'npm test\n',
    });
    expect(() => parseTerminalInput({ paneId: 'w1:p1', text: 'x'.repeat(1_048_577) })).toThrow(
      'Invalid terminal input.',
    );
  });

  it('validates server-owned terminal scroll requests', () => {
    expect(
      parseTerminalScroll({
        paneId: 'w1:p1',
        direction: 'up',
        lines: 3,
        source: 'wheel',
        column: 12,
        row: 8,
        modifiers: 2,
      }),
    ).toEqual({
      paneId: 'w1:p1',
      direction: 'up',
      lines: 3,
      source: 'wheel',
      column: 12,
      row: 8,
      modifiers: 2,
    });
    expect(() =>
      parseTerminalScroll({ paneId: 'w1:p1', direction: 'up', lines: 0, source: 'wheel' }),
    ).toThrow('Invalid terminal scroll.');
    expect(() => parseTerminalScroll({ paneId: 'w1:p1', direction: 'sideways', lines: 1 })).toThrow(
      'Invalid terminal scroll.',
    );
  });
});

describe('parseRemoteEngineTarget', () => {
  it('parses a valid target', () => {
    expect(parseRemoteEngineTarget({ enabled: true, host: 'user@host', port: 22025 })).toEqual({
      enabled: true,
      host: 'user@host',
      port: 22025,
    });
  });

  it('accepts a disabled target with an empty host', () => {
    expect(parseRemoteEngineTarget({ enabled: false, host: '', port: 22025 })).toEqual({
      enabled: false,
      host: '',
      port: 22025,
    });
  });

  it('rejects malformed targets', () => {
    for (const value of [
      null,
      'remote',
      {},
      { enabled: true, host: 'user@host' },
      { enabled: 'yes', host: 'user@host', port: 22025 },
      { enabled: true, host: 42, port: 22025 },
      { enabled: true, host: 'user@host', port: 0 },
      { enabled: true, host: 'user@host', port: 65535 },
      { enabled: true, host: 'user@host', port: 70000 },
      { enabled: true, host: 'user@host', port: 22.5 },
      { enabled: true, host: 'user@host', port: '22025' },
    ]) {
      expect(() => parseRemoteEngineTarget(value)).toThrow('Invalid remote engine target.');
    }
  });
});
