import type {
  ConversationPromptRequest,
  ConversationReadRequest,
  ConversationReadResult,
  ConversationRespondRequest,
  ConversationRespondResult,
} from '@/shared/conversation';
import { DEMO_BOOTSTRAP, demoQueryResult } from '@/shared/demo';
import type { DroverApi, HerdrCommand, HerdrQuery, HerdrQueryResult } from '@/shared/desktop-api';
import type { HerdrEventEnvelope } from '@/shared/events';
import type { EngineBootstrap } from '@/shared/herdr';
import { DEFAULT_DESKTOP_PREFERENCES, type DesktopPreferences } from '@/shared/preferences';

type ConnectedBootstrap = Extract<EngineBootstrap, { state: 'connected' }>;

export function createBrowserPreviewApi(): DroverApi {
  let connected = structuredClone(DEMO_BOOTSTRAP) as ConnectedBootstrap;
  let preferences = { ...DEFAULT_DESKTOP_PREFERENCES };
  const outputByPane = new Map<string, Extract<HerdrQueryResult, { type: 'pane-output' }>>();
  const sessionListeners = new Set<(event: HerdrEventEnvelope) => void>();
  const desktopListeners = new Set<Parameters<DroverApi['onDesktopAction']>[0]>();

  const notify = (event: string, data: Record<string, unknown>) => {
    for (const listener of sessionListeners) {
      listener({ event, data });
    }
  };

  const updateAgentPane = (paneId: string, agentStatus: 'working' | 'done', revision: number) => {
    connected = {
      ...connected,
      snapshot: {
        ...connected.snapshot,
        panes: connected.snapshot.panes.map((pane) =>
          pane.pane_id === paneId ? { ...pane, agent_status: agentStatus, revision } : pane,
        ),
        agents: connected.snapshot.agents.map((agent) =>
          agent.pane_id === paneId
            ? {
                ...agent,
                agent_status: agentStatus,
                state_change_seq: revision,
                revision,
              }
            : agent,
        ),
      },
    };
  };

  const readOutput = (paneId: string) => {
    const custom = outputByPane.get(paneId);
    if (custom) {
      return custom;
    }
    const demo = demoQueryResult({ type: 'read-pane-output', paneId });
    if (demo.type !== 'pane-output') {
      throw new Error('The preview returned an unexpected pane response.');
    }
    return demo;
  };

  const command = async (request: HerdrCommand): Promise<EngineBootstrap> => {
    if (request.type !== 'prompt-agent') {
      return structuredClone(connected);
    }
    const pane = connected.snapshot.panes.find(
      (item) =>
        item.pane_id === request.target ||
        connected.snapshot.agents.some(
          (agent) => agent.pane_id === item.pane_id && agent.name === request.target,
        ),
    );
    if (!pane) {
      throw new Error('Preview agent target was not found.');
    }
    const previous = readOutput(pane.pane_id);
    const workingRevision = previous.revision + 1;
    updateAgentPane(pane.pane_id, 'working', workingRevision);
    outputByPane.set(pane.pane_id, {
      ...previous,
      text: `Working on “${request.text}”…\n\nI am applying the requested change through the Herdr-powered preview.`,
      revision: workingRevision,
    });

    window.setTimeout(() => {
      const doneRevision = workingRevision + 1;
      updateAgentPane(pane.pane_id, 'done', doneRevision);
      outputByPane.set(pane.pane_id, {
        ...previous,
        text: `Done. “${request.text}” has been applied.\n\nThe chat stayed in the desktop theme while Herdr remained the runtime authority.`,
        revision: doneRevision,
      });
      notify('pane.output_changed', { pane_id: pane.pane_id, revision: doneRevision });
    }, 800);

    return structuredClone(connected);
  };

  const query = async (request: HerdrQuery): Promise<HerdrQueryResult> => {
    switch (request.type) {
      case 'read-pane-output':
        return structuredClone(readOutput(request.paneId));
      case 'list-plugins':
        return { type: 'plugin-list', plugins: [] };
      case 'list-plugin-actions':
        return { type: 'plugin-action-list', actions: [] };
      case 'get-agent-manifests':
        return { type: 'agent-manifests', manifests: [] };
      case 'list-worktrees':
        return {
          type: 'worktree-list',
          source: {
            repo_key: 'github.com/herdrdev/drover',
            repo_name: 'drover',
            repo_root: '/preview/drover',
            source_checkout_path: '/preview/drover',
            source_workspace_id: 'w1',
          },
          worktrees: [],
        };
    }
  };

  return {
    bootstrap: async () => structuredClone(connected),
    startServer: async () => structuredClone(connected),
    command,
    query,
    readPreferences: async () => ({ ...preferences }),
    writePreferences: async (next: DesktopPreferences) => {
      preferences = { ...next };
      return { ...preferences };
    },
    chooseHerdrBinary: async () => structuredClone(connected),
    resetHerdrBinary: async () => structuredClone(connected),
    engineUpdate: async () => ({
      bootstrap: structuredClone(connected),
      updated: false,
      version: '0.8.0',
      message: 'Preview mode: the Herdr engine update is disabled.',
    }),
    checkDesktopUpdate: async () => ({
      currentVersion: '0.0.0-preview',
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: 'https://github.com/marcelormendes/drover/releases/latest',
    }),
    applyRemoteEngine: async (target) => ({ state: 'off', host: target.host, port: target.port }),
    remoteEngineStatus: async () => ({ state: 'off', host: '', port: 22025 }),
    onDesktopAction: (listener) => {
      desktopListeners.add(listener);
      return () => desktopListeners.delete(listener);
    },
    conversation: {
      read: async (_request: ConversationReadRequest): Promise<ConversationReadResult> => {
        throw new Error('Structured Chat is unavailable in browser preview.');
      },
      prompt: async (_request: ConversationPromptRequest): Promise<EngineBootstrap> => connected,
      respond: async (_request: ConversationRespondRequest): Promise<ConversationRespondResult> => {
        throw new Error('Structured Chat is unavailable in browser preview.');
      },
      subscribe: async (_paneId: string) => undefined,
      unsubscribe: async (_paneId: string) => undefined,
      attachment: {
        begin: async () => {
          throw new Error('Structured Chat is unavailable in browser preview.');
        },
        chunk: async () => undefined,
        finish: async () => {
          throw new Error('Structured Chat is unavailable in browser preview.');
        },
        abort: async () => undefined,
      },
    },
    onSessionEvent: (listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    terminal: {
      open: async () => undefined,
      input: async () => undefined,
      resize: async () => undefined,
      scroll: async () => undefined,
      close: async () => undefined,
      onEvent: () => () => undefined,
      readClipboard: async () => '',
      writeClipboard: async () => undefined,
      accessibilitySupportEnabled: async () => false,
    },
    openExternal: async () => undefined,
  };
}
