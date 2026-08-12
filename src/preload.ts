import { contextBridge, ipcRenderer } from 'electron';
import type {
  ConversationAttachmentAbortRequest,
  ConversationAttachmentBeginRequest,
  ConversationAttachmentBeginResult,
  ConversationAttachmentChunkRequest,
  ConversationAttachmentFinishRequest,
  ConversationPromptRequest,
  ConversationReadRequest,
  ConversationReadResult,
  ConversationRespondRequest,
  ConversationRespondResult,
  ConversationStagedAttachment,
} from '@/shared/conversation';
import type {
  DesktopAction,
  DesktopUpdateInfo,
  DroverApi,
  EngineUpdateResult,
  HerdrCommand,
  HerdrQuery,
  HerdrQueryResult,
} from '@/shared/desktop-api';
import type { HerdrEventEnvelope } from '@/shared/events';
import type { EngineBootstrap } from '@/shared/herdr';
import { IPC_CHANNELS } from '@/shared/ipc';
import type { DesktopPreferences } from '@/shared/preferences';
import type { RemoteEngineStatus, RemoteEngineTarget } from '@/shared/remote-engine';
import type {
  TerminalEvent,
  TerminalInputRequest,
  TerminalOpenRequest,
  TerminalResizeRequest,
  TerminalScrollRequest,
} from '@/shared/terminal';

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: DroverApi = {
  bootstrap: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap) as Promise<EngineBootstrap>,
  startServer: () => ipcRenderer.invoke(IPC_CHANNELS.startServer) as Promise<EngineBootstrap>,
  command: (command: HerdrCommand) =>
    ipcRenderer.invoke(IPC_CHANNELS.command, command) as Promise<EngineBootstrap>,
  query: (query: HerdrQuery) =>
    ipcRenderer.invoke(IPC_CHANNELS.query, query) as Promise<HerdrQueryResult>,
  conversation: Object.freeze({
    read: (request: ConversationReadRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.conversationRead, request) as Promise<ConversationReadResult>,
    prompt: (request: ConversationPromptRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.conversationPrompt, request) as Promise<EngineBootstrap>,
    respond: (request: ConversationRespondRequest) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.conversationRespond,
        request,
      ) as Promise<ConversationRespondResult>,
    subscribe: (paneId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.conversationSubscribe, paneId) as Promise<void>,
    unsubscribe: (paneId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.conversationUnsubscribe, paneId) as Promise<void>,
    attachment: Object.freeze({
      begin: (request: ConversationAttachmentBeginRequest) =>
        ipcRenderer.invoke(
          IPC_CHANNELS.attachmentBegin,
          request,
        ) as Promise<ConversationAttachmentBeginResult>,
      chunk: (request: ConversationAttachmentChunkRequest) =>
        ipcRenderer.invoke(IPC_CHANNELS.attachmentChunk, request) as Promise<void>,
      finish: (request: ConversationAttachmentFinishRequest) =>
        ipcRenderer.invoke(
          IPC_CHANNELS.attachmentFinish,
          request,
        ) as Promise<ConversationStagedAttachment>,
      abort: (request: ConversationAttachmentAbortRequest) =>
        ipcRenderer.invoke(IPC_CHANNELS.attachmentAbort, request) as Promise<void>,
    }),
  }),
  readPreferences: () =>
    ipcRenderer.invoke(IPC_CHANNELS.readPreferences) as Promise<DesktopPreferences>,
  writePreferences: (preferences: DesktopPreferences) =>
    ipcRenderer.invoke(IPC_CHANNELS.writePreferences, preferences) as Promise<DesktopPreferences>,
  chooseHerdrBinary: () =>
    ipcRenderer.invoke(IPC_CHANNELS.chooseBinary) as Promise<EngineBootstrap | null>,
  resetHerdrBinary: () => ipcRenderer.invoke(IPC_CHANNELS.resetBinary) as Promise<EngineBootstrap>,
  engineUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.engineUpdate) as Promise<EngineUpdateResult>,
  checkDesktopUpdate: () =>
    ipcRenderer.invoke(IPC_CHANNELS.desktopUpdateCheck) as Promise<DesktopUpdateInfo>,
  applyRemoteEngine: (target: RemoteEngineTarget) =>
    ipcRenderer.invoke(IPC_CHANNELS.remoteEngineApply, target) as Promise<RemoteEngineStatus>,
  remoteEngineStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.remoteEngineStatus) as Promise<RemoteEngineStatus>,
  onDesktopAction: (listener) => subscribe<DesktopAction>(IPC_CHANNELS.desktopAction, listener),
  onSessionEvent: (listener) => subscribe<HerdrEventEnvelope>(IPC_CHANNELS.sessionEvent, listener),
  terminal: Object.freeze({
    open: (request: TerminalOpenRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminalOpen, request) as Promise<void>,
    input: (request: TerminalInputRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminalInput, request) as Promise<void>,
    resize: (request: TerminalResizeRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminalResize, request) as Promise<void>,
    scroll: (request: TerminalScrollRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminalScroll, request) as Promise<void>,
    close: (paneId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.terminalClose, paneId) as Promise<void>,
    onEvent: (listener) => subscribe<TerminalEvent>(IPC_CHANNELS.terminalEvent, listener),
  }),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url) as Promise<void>,
};

contextBridge.exposeInMainWorld('herdr', Object.freeze(api));
