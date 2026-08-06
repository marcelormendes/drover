import { contextBridge, ipcRenderer } from 'electron';

import type {
  DesktopAction,
  HerdrCommand,
  HerdrDesktopApi,
  HerdrQuery,
  HerdrQueryResult,
} from '@/shared/desktop-api';
import type { HerdrEventEnvelope } from '@/shared/events';
import type { EngineBootstrap } from '@/shared/herdr';
import { IPC_CHANNELS } from '@/shared/ipc';
import type { DesktopPreferences } from '@/shared/preferences';
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

const api: HerdrDesktopApi = {
  bootstrap: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap) as Promise<EngineBootstrap>,
  startServer: () => ipcRenderer.invoke(IPC_CHANNELS.startServer) as Promise<EngineBootstrap>,
  command: (command: HerdrCommand) =>
    ipcRenderer.invoke(IPC_CHANNELS.command, command) as Promise<EngineBootstrap>,
  query: (query: HerdrQuery) =>
    ipcRenderer.invoke(IPC_CHANNELS.query, query) as Promise<HerdrQueryResult>,
  readPreferences: () =>
    ipcRenderer.invoke(IPC_CHANNELS.readPreferences) as Promise<DesktopPreferences>,
  writePreferences: (preferences: DesktopPreferences) =>
    ipcRenderer.invoke(IPC_CHANNELS.writePreferences, preferences) as Promise<DesktopPreferences>,
  chooseHerdrBinary: () =>
    ipcRenderer.invoke(IPC_CHANNELS.chooseBinary) as Promise<EngineBootstrap | null>,
  resetHerdrBinary: () => ipcRenderer.invoke(IPC_CHANNELS.resetBinary) as Promise<EngineBootstrap>,
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
