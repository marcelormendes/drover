import { accessSync, constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import started from 'electron-squirrel-startup';
import { APP_NAME, configureApplicationBranding } from '@/main/app-branding';
import { applicationMenuTemplate } from '@/main/application-menu';
import { stageChatImages } from '@/main/chat-images';
import { DesktopPreferencesStore } from '@/main/desktop-preferences';
import { resolveHerdrBinary } from '@/main/herdr/binary-locator';
import { HerdrBinaryPreference } from '@/main/herdr/binary-preference';
import { HerdrEngine, NodeHerdrCommandRunner, NodeHerdrServerLauncher } from '@/main/herdr/engine';
import { HerdrEventSubscription } from '@/main/herdr/event-subscription';
import { TerminalController } from '@/main/herdr/terminal-controller';
import { TerminalControllerPool } from '@/main/herdr/terminal-controller-pool';
import {
  parseChatImageDrafts,
  parseHerdrCommand,
  parseHerdrQuery,
  parsePaneId,
  parseRemoteEngineTarget,
  parseTerminalInput,
  parseTerminalOpen,
  parseTerminalResize,
  parseTerminalScroll,
} from '@/main/ipc-validation';
import { RemoteEngineTunnel } from '@/main/remote-engine';
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
      envBinary: process.env.HERDR_DESKTOP_BIN,
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
    }) ?? 'herdr'
  );
}

let herdrBinary = defaultHerdrBinary();
let engine = createEngine(herdrBinary);
let binaryPreference: HerdrBinaryPreference | null = null;
let desktopPreferences: DesktopPreferencesStore | null = null;
const remoteTunnel = new RemoteEngineTunnel();
const terminalControllers = new TerminalControllerPool(
  () => new TerminalController(undefined, herdrBinary),
);
function publishSessionEvent(event: { event: string; data: Record<string, unknown> }): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.sessionEvent, event);
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
const demoMode = !app.isPackaged && process.env.HERDR_DESKTOP_DEMO === '1';
const smokeTestMode = process.env.HERDR_DESKTOP_SMOKE_TEST === '1';
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
  return new HerdrEngine(new NodeHerdrCommandRunner(binary), new NodeHerdrServerLauncher(binary));
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
 * Applies the remote-engine tunnel: starts/stops ssh + the local socket
 * bridge, points HERDR_SOCKET_PATH at the tunnel while active, and confirms
 * reachability by bootstrapping through it. On failure the tunnel is torn
 * down and the env override removed so the local engine keeps working.
 */
async function applyRemoteEngine(target: RemoteEngineTarget): Promise<RemoteEngineStatus> {
  const status = await remoteTunnel.apply(target);
  if (status.state === 'off') {
    delete process.env.HERDR_SOCKET_PATH;
    return status;
  }
  if (status.socketPath) {
    process.env.HERDR_SOCKET_PATH = status.socketPath;
  }
  const result = await engine.bootstrap();
  if (result.state !== 'connected') {
    delete process.env.HERDR_SOCKET_PATH;
    await remoteTunnel.stop();
    return remoteTunnel.setConnected(false, remoteFailureMessage(result));
  }
  return remoteTunnel.setConnected(true);
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

  ipcMain.handle(IPC_CHANNELS.stageChatImages, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return stageChatImages(
      path.join(tmpdir(), 'herdr-desktop-chat-images'),
      parseChatImageDrafts(candidate),
    );
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
    return desktopPreferences.write(input);
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

  ipcMain.handle(IPC_CHANNELS.remoteEngineApply, async (event, candidate: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return applyRemoteEngine(parseRemoteEngineTarget(candidate));
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
    if (!process.env.HERDR_DESKTOP_BIN) {
      const selectedBinary = await binaryPreference.read();
      if (selectedBinary) {
        configureHerdrBinary(selectedBinary);
      }
    }
    const storedPreferences = await desktopPreferences.read();
    if (storedPreferences.remoteEngine.enabled) {
      // Re-establish the SSH tunnel from the persisted settings; failures
      // fall back to the local engine with the status surfaced in Settings.
      void applyRemoteEngine({
        enabled: true,
        host: storedPreferences.remoteEngine.host,
        port: storedPreferences.remoteEngine.port,
      });
    }
    registerIpcHandlers();
    configureApplicationMenu();
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  eventSubscription.close();
  terminalControllers.closeAll();
});
