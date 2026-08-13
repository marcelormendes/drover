import { accessSync, constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session, shell } from 'electron';
import started from 'electron-squirrel-startup';
import { APP_NAME, configureApplicationBranding } from '@/main/app-branding';
import { applicationMenuTemplate } from '@/main/application-menu';
import { DesktopPreferencesStore } from '@/main/desktop-preferences';
import { checkDesktopUpdate } from '@/main/desktop-update';
import { hostPathFromSandboxPath, isFlatpakHost } from '@/main/flatpak';
import { resolveHerdrBinary } from '@/main/herdr/binary-locator';
import { HerdrBinaryPreference } from '@/main/herdr/binary-preference';
import { HerdrEngine, NodeHerdrCommandRunner, NodeHerdrServerLauncher } from '@/main/herdr/engine';
import { HerdrEventSubscription } from '@/main/herdr/event-subscription';
import { TerminalController } from '@/main/herdr/terminal-controller';
import { TerminalControllerPool } from '@/main/herdr/terminal-controller-pool';
import {
  parseConversationAttachmentAbortRequest,
  parseConversationAttachmentBeginRequest,
  parseConversationAttachmentChunkRequest,
  parseConversationAttachmentFinishRequest,
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
import {
  clearRemoteSocketOverrides,
  createRemoteEngineRelauncher,
  createWillQuitHandler,
  establishPersistedRemoteEngineBeforeWindow,
  RemoteEngineTunnel,
  shouldApplyLocalFallback,
} from '@/main/remote-engine';
import { isAllowedExternalUrl, isTrustedRendererUrl } from '@/main/security';
import { ConnectedSessionTracker } from '@/main/session-tracker';
import { DEMO_BOOTSTRAP, demoQueryResult } from '@/shared/demo';
import type { EngineBootstrap } from '@/shared/herdr';
import { IPC_CHANNELS } from '@/shared/ipc';
import { parseDesktopPreferences } from '@/shared/preferences';
import type { RemoteEngineStatus, RemoteEngineTarget } from '@/shared/remote-engine';

function defaultHerdrBinary(): string {
  return (
    resolveHerdrBinary({
      envBinary: process.env.DROVER_BIN,
      home: homedir(),
      pathEntries: (process.env.PATH ?? '').split(':'),
      canExecute: (file) => {
        try {
          accessSync(file, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      },
      flatpakHost: isFlatpakHost(),
    }) ?? 'herdr'
  );
}

let herdrBinary = defaultHerdrBinary();
let engine = createEngine(herdrBinary);
let binaryPreference: HerdrBinaryPreference | null = null;
let desktopPreferences: DesktopPreferencesStore | null = null;
let preferencesWriteQueue = Promise.resolve();
const conversationSubscriptions = new Set<string>();

function enqueuePreferencesWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = preferencesWriteQueue.then(operation);
  preferencesWriteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function persistRemoteEngineTarget(target: RemoteEngineTarget): Promise<void> {
  return enqueuePreferencesWrite(async () => {
    const store = desktopPreferences;
    if (!store) {
      throw new Error('Desktop preferences are unavailable.');
    }
    const current = await store.read();
    const { schemaVersion: _schemaVersion, ...input } = current;
    await store.write({ ...input, remoteEngine: target });
  });
}

const requestRemoteEngineRelaunch = createRemoteEngineRelauncher({
  persistTarget: persistRemoteEngineTarget,
  relaunch: () => app.relaunch(),
  quit: () => app.quit(),
});
const remoteTunnel = new RemoteEngineTunnel({
  onStatusChange: (status) => {
    publishSessionEvent({ event: 'desktop.remote_engine_state', data: { status } });
    if (status.state === 'error') {
      // Async tunnel failures must not leave the app pointing at a dead
      // bridge: clear the override and fall back to the local engine. The
      // fallback is generation-guarded so a slow local bootstrap can never
      // move the session back to local after a newer remote apply won.
      const generation = remoteApplyGeneration;
      clearRemoteSocketOverrides();
      void engine.bootstrap().then((result) => {
        if (
          result.state === 'connected' &&
          shouldApplyLocalFallback(generation, remoteApplyGeneration, remoteTunnel.active)
        ) {
          trackConnectedSession(result);
        }
      });
    }
  },
});
const terminalControllers = new TerminalControllerPool(
  () => new TerminalController(undefined, herdrBinary),
);
function publishSessionEvent(event: { event: string; data: Record<string, unknown> }): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.sessionEvent, event);
    }
  }
}

const eventSubscription = new HerdrEventSubscription(
  publishSessionEvent,
  (error) => console.error('Herdr event stream error:', error.message),
  {
    resolveReconnectTarget: async () => {
      const result = await engine.bootstrap();
      if (result.state !== 'connected') {
        throw new Error('Herdr session is not ready for event reconnection.');
      }
      publishSessionEvent({ event: 'desktop.resynchronized', data: {} });
      return {
        socketPath: result.status.server.socket,
        paneIds: result.snapshot.panes.map((pane) => pane.pane_id),
        conversationPaneIds: eventSubscription.getConversationPaneIds(),
      };
    },
    onStateChange: (state) =>
      publishSessionEvent({ event: 'desktop.connection_state', data: { state } }),
  },
);
// Background refreshes re-bootstrap constantly and return the same session;
// only re-open the event stream when the session actually changed, or the
// pill flickers through connecting/disconnected on every refresh.
const sessionTracker = new ConnectedSessionTracker(eventSubscription);
const demoMode = !app.isPackaged && process.env.DROVER_DEMO === '1';
const smokeTestMode = process.env.DROVER_SMOKE_TEST === '1';
const packagedRendererPath = path.join(
  __dirname,
  `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
);
const trustedRendererUrl =
  MAIN_WINDOW_VITE_DEV_SERVER_URL || pathToFileURL(packagedRendererPath).href;

if (started) {
  app.quit();
}

function createEngine(binary: string): HerdrEngine {
  return new HerdrEngine(
    new NodeHerdrCommandRunner(binary),
    new NodeHerdrServerLauncher(binary),
    undefined,
    undefined,
    (installed) => configureHerdrBinary(installed),
  );
}

function configureHerdrBinary(binary: string): void {
  terminalControllers.closeAll();
  herdrBinary = binary;
  engine = createEngine(binary);
}

function remoteFailureMessage(result: EngineBootstrap): string {
  switch (result.state) {
    case 'connected':
      return '';
    case 'stopped':
      return 'No Herdr server is running on the target machine.';
    case 'incompatible':
      return 'The remote Herdr version is incompatible with the local client.';
    case 'missing':
      return 'The Herdr binary was not found.';
    default:
      return result.message ?? 'Could not reach the remote Herdr engine.';
  }
}

/**
 * Applies the remote-engine tunnel: starts/stops ssh + the local API/client
 * socket bridges, points both Herdr socket environment variables at the
 * tunnel while active, and confirms reachability by bootstrapping through it.
 * On failure the tunnel is torn down and both env overrides are removed so
 * the local engine keeps working.
 * Applies are generation-guarded so a stale bootstrap can never commit a
 * status for a target that was already superseded.
 */
let remoteApplyGeneration = 0;
let engineGeneration = 0;
async function applyRemoteEngine(target: RemoteEngineTarget): Promise<RemoteEngineStatus> {
  const generation = ++remoteApplyGeneration;
  // The engine target is changing: existing terminal controllers were spawned
  // against the old engine. closeAll() deliberately suppresses their
  // terminal.closed events (the generation guard in TerminalController), so
  // the renderer is told explicitly to attach again once the target is final.
  terminalControllers.closeAll();
  const status = await remoteTunnel.apply(target);
  if (generation !== remoteApplyGeneration) {
    return remoteTunnel.status;
  }
  if (status.state !== 'starting') {
    // off: tunnel stopped cleanly. error: setup/validation/bridge failure —
    // never let a healthy local bootstrap overwrite it with "connected".
    if (status.state === 'off') {
      clearRemoteSocketOverrides();
    }
    publishEngineChanged();
    return status;
  }
  if (status.socketPath) {
    process.env.HERDR_SOCKET_PATH = hostPathFromSandboxPath(status.socketPath);
  }
  if (status.clientSocketPath) {
    process.env.HERDR_CLIENT_SOCKET_PATH = hostPathFromSandboxPath(status.clientSocketPath);
  }
  const result = await engine.bootstrap();
  if (generation !== remoteApplyGeneration) {
    return remoteTunnel.status;
  }
  if (result.state !== 'connected') {
    clearRemoteSocketOverrides();
    await remoteTunnel.stop();
    const failed = remoteTunnel.setConnected(false, remoteFailureMessage(result));
    publishEngineChanged();
    return failed;
  }
  const connected = remoteTunnel.setConnected(true);
  publishEngineChanged();
  return connected;
}

function publishEngineChanged(): void {
  engineGeneration += 1;
  publishSessionEvent({
    event: 'desktop.engine_changed',
    data: { generation: engineGeneration },
  });
}

function assertTrustedSender(url: string | undefined): void {
  if (!url || !isTrustedRendererUrl(url, trustedRendererUrl)) {
    throw new Error('Rejected IPC request from an untrusted renderer.');
  }
}

function trackConnectedSession(result: EngineBootstrap): EngineBootstrap {
  if (demoMode) {
    return result;
  }
  return sessionTracker.track(result);
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.bootstrap, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return trackConnectedSession(demoMode ? DEMO_BOOTSTRAP : await engine.bootstrap());
  });

  ipcMain.handle(IPC_CHANNELS.startServer, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    if (remoteTunnel.active) {
      // The tunnel owns the socket path; never start a local server on top of it.
      return trackConnectedSession(demoMode ? DEMO_BOOTSTRAP : await engine.bootstrap());
    }
    return trackConnectedSession(demoMode ? DEMO_BOOTSTRAP : await engine.startServer());
  });

  ipcMain.handle(IPC_CHANNELS.command, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (demoMode) {
      return DEMO_BOOTSTRAP;
    }
    return trackConnectedSession(await engine.execute(parseHerdrCommand(candidate)));
  });

  ipcMain.handle(IPC_CHANNELS.query, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (demoMode) {
      return demoQueryResult(parseHerdrQuery(candidate));
    }
    return engine.query(parseHerdrQuery(candidate));
  });

  ipcMain.handle(IPC_CHANNELS.conversationRead, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (demoMode) {
      throw new Error('Structured Chat is unavailable in demo mode.');
    }
    return engine.conversationRead(parseConversationReadRequest(candidate));
  });
  ipcMain.handle(IPC_CHANNELS.conversationMetadata, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (demoMode) {
      throw new Error('Structured Chat is unavailable in demo mode.');
    }
    return engine.conversationMetadata(parseConversationReadRequest(candidate));
  });

  ipcMain.handle(IPC_CHANNELS.conversationPrompt, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (demoMode) {
      return DEMO_BOOTSTRAP;
    }
    return trackConnectedSession(
      await engine.conversationPrompt(parseConversationPromptRequest(candidate)),
    );
  });

  ipcMain.handle(IPC_CHANNELS.conversationRespond, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (demoMode) {
      throw new Error('Structured Chat is unavailable in demo mode.');
    }
    return engine.conversationRespond(parseConversationRespondRequest(candidate));
  });

  ipcMain.handle(IPC_CHANNELS.attachmentBegin, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (demoMode) {
      throw new Error('Structured Chat is unavailable in demo mode.');
    }
    return engine.conversationAttachmentBegin(parseConversationAttachmentBeginRequest(candidate));
  });

  ipcMain.handle(IPC_CHANNELS.attachmentChunk, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (demoMode) {
      throw new Error('Structured Chat is unavailable in demo mode.');
    }
    return engine.conversationAttachmentChunk(parseConversationAttachmentChunkRequest(candidate));
  });

  ipcMain.handle(IPC_CHANNELS.attachmentFinish, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (demoMode) {
      throw new Error('Structured Chat is unavailable in demo mode.');
    }
    return engine.conversationAttachmentFinish(parseConversationAttachmentFinishRequest(candidate));
  });

  ipcMain.handle(IPC_CHANNELS.attachmentAbort, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (demoMode) {
      throw new Error('Structured Chat is unavailable in demo mode.');
    }
    return engine.conversationAttachmentAbort(parseConversationAttachmentAbortRequest(candidate));
  });

  ipcMain.handle(IPC_CHANNELS.conversationSubscribe, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const paneId = parsePaneId(candidate);
    conversationSubscriptions.add(paneId);
    eventSubscription.setConversationPanes([...conversationSubscriptions]);
  });

  ipcMain.handle(IPC_CHANNELS.conversationUnsubscribe, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const paneId = parsePaneId(candidate);
    conversationSubscriptions.delete(paneId);
    eventSubscription.setConversationPanes([...conversationSubscriptions]);
  });

  ipcMain.handle(IPC_CHANNELS.readPreferences, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    if (!desktopPreferences) {
      throw new Error('Desktop preferences are unavailable.');
    }
    return desktopPreferences.read();
  });

  ipcMain.handle(IPC_CHANNELS.writePreferences, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const parsed = parseDesktopPreferences(candidate);
    if (!parsed || !desktopPreferences) {
      throw new Error('Invalid desktop preferences.');
    }
    const { schemaVersion: _schemaVersion, ...input } = parsed;
    const store = desktopPreferences;
    if (!store) {
      throw new Error('Desktop preferences are unavailable.');
    }
    return enqueuePreferencesWrite(() => store.write(input));
  });

  ipcMain.handle(IPC_CHANNELS.chooseBinary, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Choose the Herdr binary',
      buttonLabel: 'Use Herdr',
      properties: ['openFile'],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (result.canceled || !selected) {
      return null;
    }
    await access(selected, constants.X_OK);
    await binaryPreference?.write(selected);
    configureHerdrBinary(selected);
    return trackConnectedSession(await engine.bootstrap());
  });

  ipcMain.handle(IPC_CHANNELS.resetBinary, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    await binaryPreference?.clear();
    configureHerdrBinary(defaultHerdrBinary());
    return trackConnectedSession(await engine.bootstrap());
  });

  ipcMain.handle(IPC_CHANNELS.engineUpdate, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    // In remote mode the updater would replace the local binary and then try
    // to hand off through the SSH bridge using a local executable path, which
    // cannot work on the remote host. The desktop only updates its own engine.
    if (remoteTunnel.active) {
      const bootstrap = trackConnectedSession(demoMode ? DEMO_BOOTSTRAP : await engine.bootstrap());
      const version = bootstrap.state === 'connected' ? bootstrap.status.client.version : null;
      const message = 'Herdr engine updates are disabled while connected to a remote engine.';
      return { bootstrap, updated: false, version, message, error: message };
    }
    if (demoMode) {
      const version =
        DEMO_BOOTSTRAP.state === 'connected' ? DEMO_BOOTSTRAP.status.client.version : null;
      return {
        bootstrap: trackConnectedSession(DEMO_BOOTSTRAP),
        updated: false,
        version,
        message: 'Demo mode: the Herdr engine update is disabled.',
      };
    }
    const result = await engine.update();
    return { ...result, bootstrap: trackConnectedSession(result.bootstrap) };
  });

  ipcMain.handle(IPC_CHANNELS.desktopUpdateCheck, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return checkDesktopUpdate(app.getVersion());
  });

  ipcMain.handle(IPC_CHANNELS.remoteEngineApply, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return requestRemoteEngineRelaunch(parseRemoteEngineTarget(candidate));
  });

  ipcMain.handle(IPC_CHANNELS.remoteEngineStatus, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return remoteTunnel.status;
  });

  ipcMain.handle(IPC_CHANNELS.terminalOpen, (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const request = parseTerminalOpen(candidate);
    terminalControllers.open(request, (terminalEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.terminalEvent, terminalEvent);
      }
    });
  });

  ipcMain.handle(IPC_CHANNELS.terminalInput, (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const request = parseTerminalInput(candidate);
    terminalControllers.input(request.paneId, request.text);
  });

  ipcMain.handle(IPC_CHANNELS.terminalResize, (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const request = parseTerminalResize(candidate);
    terminalControllers.resize(
      request.paneId,
      request.cols,
      request.rows,
      request.cellWidthPx,
      request.cellHeightPx,
    );
  });

  ipcMain.handle(IPC_CHANNELS.terminalScroll, (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const request = parseTerminalScroll(candidate);
    const { paneId, ...command } = request;
    terminalControllers.scroll(paneId, command);
  });

  ipcMain.handle(IPC_CHANNELS.terminalClose, (event, paneId: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    terminalControllers.close(parsePaneId(paneId));
  });

  ipcMain.handle(IPC_CHANNELS.terminalClipboardRead, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return clipboard.readText();
  });

  ipcMain.handle(IPC_CHANNELS.terminalClipboardWrite, (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof candidate !== 'string') {
      throw new Error('Invalid clipboard text.');
    }
    clipboard.writeText(candidate);
  });

  ipcMain.handle(IPC_CHANNELS.terminalAccessibilitySupport, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return app.isAccessibilitySupportEnabled();
  });

  ipcMain.handle(IPC_CHANNELS.openExternal, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof candidate !== 'string' || !isAllowedExternalUrl(candidate)) {
      throw new Error('Rejected external URL.');
    }
    await shell.openExternal(candidate);
  });
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 540,
    show: false,
    backgroundColor: '#e8effa',
    icon: path.join(app.getAppPath(), 'resources', 'icon-1024.png'),
    title: APP_NAME,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 16 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.setVisualZoomLevelLimits(1, 3);
  if (smokeTestMode) {
    mainWindow.webContents.once('did-finish-load', () => app.exit(0));
    mainWindow.webContents.once('did-fail-load', (_event, code, description, url) => {
      console.error(`Renderer failed to load (${code}): ${description} — ${url}`);
      app.exit(1);
    });
  }
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, trustedRendererUrl)) {
      event.preventDefault();
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.once('closed', () => terminalControllers.closeAll());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(packagedRendererPath);
  }
}

function configureApplicationMenu(): void {
  const menu = Menu.buildFromTemplate(
    applicationMenuTemplate(process.platform, (action) => {
      const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (target && !target.webContents.isDestroyed()) {
        target.webContents.send(IPC_CHANNELS.desktopAction, action);
      }
    }),
  );
  Menu.setApplicationMenu(menu);
}

if (!started) {
  app.whenReady().then(async () => {
    configureApplicationBranding(app, {
      isPackaged: app.isPackaged,
      platform: process.platform,
      resourcesDirectory: path.join(app.getAppPath(), 'resources'),
    });
    binaryPreference = new HerdrBinaryPreference(
      path.join(app.getPath('userData'), 'settings.json'),
    );
    desktopPreferences = new DesktopPreferencesStore(
      path.join(app.getPath('userData'), 'desktop-preferences.json'),
    );
    if (!process.env.DROVER_BIN) {
      const selectedBinary = await binaryPreference.read();
      if (selectedBinary) {
        configureHerdrBinary(selectedBinary);
      }
    }
    const storedPreferences = await desktopPreferences.read();
    await establishPersistedRemoteEngineBeforeWindow(
      storedPreferences,
      async (target) => {
        try {
          // Re-establish the SSH tunnel from persisted settings before any
          // renderer can bootstrap the local engine.
          await applyRemoteEngine(target);
        } catch (error) {
          // Leave startup usable even if an unexpected setup error escaped the
          // normal tunnel/bootstrap failure paths.
          console.error(
            `Could not establish the persisted remote Herdr engine: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          clearRemoteSocketOverrides();
          await remoteTunnel.stop().catch(() => undefined);
        }
      },
      () => {
        registerIpcHandlers();
        configureApplicationMenu();
        session.defaultSession.setPermissionRequestHandler(
          (_webContents, _permission, callback) => {
            callback(false);
          },
        );
        createWindow();

        app.on('activate', () => {
          if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
          }
        });
      },
    );
  });
}

// Never leave the SSH process or the bridge socket behind after quitting.
// stop() is queued behind any in-flight apply, so a quit during bridge
// creation cannot be raced by a late tunnel install; the coordinator lets
// the retried quit proceed once cleanup finished.
app.on(
  'will-quit',
  createWillQuitHandler({
    stop: () => remoteTunnel.stop(),
    quit: () => app.quit(),
  }),
);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  eventSubscription.close();
  terminalControllers.closeAll();
});
