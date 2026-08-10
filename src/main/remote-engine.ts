import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { flatpakRemoteSocketDir, hostInvocation, isFlatpakHost } from '@/main/flatpak';

import type { DesktopPreferences } from '@/shared/preferences';
import {
  MAX_REMOTE_ENGINE_PORT,
  type RemoteEngineState,
  type RemoteEngineStatus,
  type RemoteEngineTarget,
  remoteClientPort,
} from '@/shared/remote-engine';

export type {
  RemoteEngineState,
  RemoteEngineStatus,
  RemoteEngineTarget,
} from '@/shared/remote-engine';

/** The slice of node:child_process.ChildProcess the tunnel relies on. */
export interface TunnelChildProcess {
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
}

export interface TunnelBridge {
  close(): void;
}

export interface RemoteEngineTunnelOptions {
  /** Injectable process spawner (defaults to node:child_process.spawn). */
  sshSpawn?: (command: string, args: string[], options: { stdio: 'ignore' }) => TunnelChildProcess;
  /** Injectable Unix-socket-to-TCP bridge factory. */
  createBridge?: (socketPath: string, port: number) => Promise<TunnelBridge>;
  /** Injectable readiness wait; defaults to probing both SSH local forwards. */
  waitForForwarding?: (ports: number[], child: TunnelChildProcess) => Promise<void>;
  /** Local Unix socket for the Herdr API; defaults to a temp path. */
  socketPath?: string;
  /** Local Unix socket for Herdr terminal control; defaults to a temp path. */
  clientSocketPath?: string;
  /** Fired on every status transition so the caller can publish/fall back. */
  onStatusChange?: (status: RemoteEngineStatus) => void;
}

const SSH_FORWARD_READY_TIMEOUT_MS = 10_000;
const SSH_FORWARD_READY_POLL_MS = 50;

function probeTcpPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

async function waitForTcpForwarding(ports: number[]): Promise<void> {
  const waitForPort = async (port: number): Promise<void> => {
    const deadline = Date.now() + SSH_FORWARD_READY_TIMEOUT_MS;
    let lastError: unknown;
    while (true) {
      try {
        await probeTcpPort(port);
        return;
      } catch (error) {
        lastError = error;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
        throw new Error(
          `SSH forwarding on local port ${port} did not become ready within ${SSH_FORWARD_READY_TIMEOUT_MS}ms${detail}`,
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(SSH_FORWARD_READY_POLL_MS, remaining)),
      );
    }
  };

  await Promise.all(ports.map((port) => waitForPort(port)));
}

function waitForSshForwarding(ports: number[], child: TunnelChildProcess): Promise<void> {
  return Promise.race([
    waitForTcpForwarding(ports),
    new Promise<void>((_resolve, reject) => {
      child.once('error', (error) =>
        reject(new Error(`Could not start the SSH tunnel: ${error.message}`)),
      );
      child.once('exit', (code) =>
        reject(new Error(`SSH tunnel exited (code ${code ?? 'unknown'}).`)),
      );
    }),
  ]);
}

export interface RemoteEngineRelaunchOptions {
  /** Persists the requested target before Electron is relaunched. */
  persistTarget: (target: RemoteEngineTarget) => Promise<void>;
  relaunch: () => void;
  quit: () => void;
}

/**
 * Serializes the user-requested engine boundary change into one full app
 * relaunch. The startup path deliberately does not use this helper, which
 * prevents the newly launched process from relaunching itself in a loop.
 */
export function createRemoteEngineRelauncher(options: RemoteEngineRelaunchOptions) {
  let request: Promise<RemoteEngineStatus> | null = null;
  return (target: RemoteEngineTarget): Promise<RemoteEngineStatus> => {
    if (request) {
      return request;
    }
    const run: Promise<RemoteEngineStatus> = (async () => {
      await options.persistTarget(target);
      options.relaunch();
      options.quit();
      return {
        state: target.enabled ? 'starting' : 'off',
        host: target.host.trim(),
        port: target.port,
      };
    })();
    const pending = run.catch((error): never => {
      request = null;
      throw error;
    });
    request = pending;
    return pending;
  };
}

/**
 * Keeps the renderer from observing local engine state while a persisted
 * remote engine is being re-established during a clean app startup.
 */
export async function establishPersistedRemoteEngineBeforeWindow(
  preferences: Pick<DesktopPreferences, 'remoteEngine'>,
  establish: (target: RemoteEngineTarget) => Promise<unknown>,
  createWindow: () => void,
): Promise<void> {
  if (preferences.remoteEngine.enabled) {
    const { enabled, host, port } = preferences.remoteEngine;
    await establish({ enabled, host, port });
  } else {
    clearRemoteSocketOverrides();
  }
  createWindow();
}

export function defaultTunnelSocketPath(): string {
  if (isFlatpakHost()) {
    // Sandbox-private tmp is unreachable by the host Herdr server; keep the
    // bridge sockets under the host-visible remote grant instead.
    return path.join(flatpakRemoteSocketDir(), 'herdr-desktop-remote.sock');
  }
  return path.join(os.tmpdir(), 'herdr-desktop-remote.sock');
}

export function defaultTunnelClientSocketPath(): string {
  if (isFlatpakHost()) {
    return path.join(flatpakRemoteSocketDir(), 'herdr-desktop-remote-client.sock');
  }
  return path.join(os.tmpdir(), 'herdr-desktop-remote-client.sock');
}

export function clearRemoteSocketOverrides(): void {
  delete process.env.HERDR_SOCKET_PATH;
  delete process.env.HERDR_CLIENT_SOCKET_PATH;
}

/**
 * Bridges a local Unix socket to a TCP port forwarded over SSH:
 * clients → <socketPath> → 127.0.0.1:<port> → `ssh -L` → remote socat → a
 * remote Herdr Unix socket. The tunnel owns one bridge for the API socket and
 * one for the terminal-control client socket.
 */
export function createTcpBridge(socketPath: string, port: number): Promise<TunnelBridge> {
  return new Promise((resolve, reject) => {
    // The host-visible Flatpak socket directory must exist before listen().
    mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    const server = net.createServer((client) => {
      const upstream = net.connect(port, '127.0.0.1');
      const teardown = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', teardown);
      upstream.on('error', teardown);
      client.pipe(upstream).pipe(client);
    });
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve({ close: () => server.close() });
    });
  });
}

/**
 * Electron `will-quit` coordinator: prevents the first quit while the tunnel
 * is stopped (deduplicating repeats during cleanup) and lets the retried
 * quit proceed once cleanup finished, so the app can always finish quitting.
 */
export function createWillQuitHandler(options: {
  stop: () => Promise<void>;
  quit: () => void;
}): (event: { preventDefault(): void }) => void {
  let quitting = false;
  let cleanupDone = false;
  return (event) => {
    if (quitting && cleanupDone) {
      return; // cleanup settled (even on failure); allow the retried quit
    }
    event.preventDefault();
    if (quitting) {
      return; // still cleaning up; dedupe this repeat
    }
    quitting = true;
    void options
      .stop()
      .catch(() => undefined)
      .finally(() => {
        cleanupDone = true;
        options.quit();
      });
  };
}

/**
 * Decides whether a stale local-engine fallback may commit: only when no
 * newer remote-engine apply superseded it and no tunnel is active.
 */
export function shouldApplyLocalFallback(
  generation: number,
  currentGeneration: number,
  tunnelActive: boolean,
): boolean {
  return generation === currentGeneration && !tunnelActive;
}

/**
 * Owns the SSH tunnel + local socket bridges that make a Herdr server on
 * another machine look like the local engine. When active, the caller sets
 * HERDR_SOCKET_PATH and HERDR_CLIENT_SOCKET_PATH to the two status paths so
 * spawned Herdr binaries, API/event clients, and terminal controllers all
 * talk through the tunnel.
 *
 * Applies are serialized (a queue) so an enable that pauses during bridge
 * creation cannot resurrect itself after a newer disable. Async SSH failures
 * tear the bridge and socket down and surface an error status; the caller
 * decides how to fall back.
 */
export class RemoteEngineTunnel {
  private readonly sshSpawn: NonNullable<RemoteEngineTunnelOptions['sshSpawn']>;
  private readonly createBridge: NonNullable<RemoteEngineTunnelOptions['createBridge']>;
  private readonly waitForForwarding: NonNullable<RemoteEngineTunnelOptions['waitForForwarding']>;
  private readonly socketPath: string;
  private readonly clientSocketPath: string;
  private readonly onStatusChange: RemoteEngineTunnelOptions['onStatusChange'];
  private ssh: TunnelChildProcess | null = null;
  private apiBridge: TunnelBridge | null = null;
  private clientBridge: TunnelBridge | null = null;
  private current: RemoteEngineStatus = {
    state: 'off',
    host: '',
    port: 22025,
  };
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: RemoteEngineTunnelOptions = {}) {
    this.sshSpawn = options.sshSpawn ?? spawn;
    this.createBridge = options.createBridge ?? createTcpBridge;
    this.waitForForwarding = options.waitForForwarding ?? waitForSshForwarding;
    this.socketPath = options.socketPath ?? defaultTunnelSocketPath();
    this.clientSocketPath = options.clientSocketPath ?? defaultTunnelClientSocketPath();
    this.onStatusChange = options.onStatusChange;
  }

  get status(): RemoteEngineStatus {
    return this.current;
  }

  get active(): boolean {
    return this.current.state === 'starting' || this.current.state === 'connected';
  }

  apply(target: RemoteEngineTarget): Promise<RemoteEngineStatus> {
    const run = this.queue.then(() => this.doApply(target));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doApply({ enabled, host, port }: RemoteEngineTarget): Promise<RemoteEngineStatus> {
    await this.teardown();
    const trimmedHost = host.trim();
    this.current = { ...this.current, host: trimmedHost, port };
    if (!enabled) {
      return this.setStatus('off');
    }
    if (!trimmedHost) {
      return this.setStatus('error', 'Enter an SSH target like user@host.');
    }
    if (!Number.isInteger(port) || port < 1 || port > MAX_REMOTE_ENGINE_PORT) {
      return this.setStatus(
        'error',
        `Port must be between 1 and ${MAX_REMOTE_ENGINE_PORT}; the client forward uses the next port.`,
      );
    }
    const clientPort = remoteClientPort(port);
    // Connecting work is active from here on: a quit during bridge creation
    // must still be able to see the tunnel as active and stop it.
    this.setStatus('starting', undefined, this.socketPath, this.clientSocketPath);
    try {
      this.apiBridge = await this.createBridge(this.socketPath, port);
      this.clientBridge = await this.createBridge(this.clientSocketPath, clientPort);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.teardown();
      return this.setStatus('error', `Could not start the local socket bridge: ${message}`);
    }
    const { program: sshProgram, args: bridgedSshArgs } = hostInvocation('ssh', [
      '-N',
      '-L',
      `${port}:127.0.0.1:${port}`,
      '-L',
      `${clientPort}:127.0.0.1:${clientPort}`,
      trimmedHost,
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ServerAliveCountMax=3',
    ]);
    const child = this.sshSpawn(sshProgram, bridgedSshArgs, { stdio: 'ignore' });
    this.ssh = child;
    let readinessSettled = false;
    child.once('error', (error) => {
      if (readinessSettled && this.ssh === child) {
        this.ssh = null;
        void this.fail(`Could not start the SSH tunnel: ${error.message}`);
      }
    });
    child.once('exit', (code) => {
      if (readinessSettled && this.ssh === child) {
        this.ssh = null;
        void this.fail(`SSH tunnel exited (code ${code ?? 'unknown'}).`);
      }
    });
    try {
      await this.waitForForwarding([port, clientPort], child);
      readinessSettled = true;
      return this.current;
    } catch (error) {
      readinessSettled = true;
      if (this.ssh !== child) {
        return this.current;
      }
      await this.teardown();
      return this.setStatus('error', error instanceof Error ? error.message : String(error));
    }
  }

  /** Confirms reachability after the caller bootstraps through the tunnel. */
  setConnected(connected: boolean, message?: string): RemoteEngineStatus {
    // Connected may only be committed from an in-flight (starting) tunnel;
    // a setup/validation error must never be overwritten by a healthy local
    // bootstrap.
    if (connected && this.current.state !== 'starting') {
      return this.current;
    }
    return this.setStatus(
      connected ? 'connected' : 'error',
      message,
      connected ? this.socketPath : undefined,
      connected ? this.clientSocketPath : undefined,
    );
  }

  stop(): Promise<void> {
    // Runs through the same queue as apply so a quit during an in-flight
    // apply cannot be raced by a late tunnel install.
    const run = this.queue.then(() => this.doStop());
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doStop(): Promise<void> {
    await this.teardown();
    this.setStatus('off');
  }

  /** Async SSH failure path: full cleanup, then an error status. */
  private async fail(message: string): Promise<void> {
    await this.teardown();
    this.setStatus('error', message);
  }

  private async teardown(): Promise<void> {
    if (this.ssh) {
      const child = this.ssh;
      this.ssh = null;
      child.kill('SIGTERM');
    }
    const bridges = [this.apiBridge, this.clientBridge];
    this.apiBridge = null;
    this.clientBridge = null;
    for (const bridge of bridges) {
      bridge?.close();
    }
    await Promise.all(
      [this.socketPath, this.clientSocketPath].map((socketPath) =>
        rm(socketPath, { force: true }).catch(() => undefined),
      ),
    );
  }

  private setStatus(
    state: RemoteEngineState,
    message?: string,
    socketPath?: string,
    clientSocketPath?: string,
  ): RemoteEngineStatus {
    this.current = {
      state,
      host: this.current.host,
      port: this.current.port,
      ...(socketPath ? { socketPath } : {}),
      ...(clientSocketPath ? { clientSocketPath } : {}),
      ...(message !== undefined ? { message } : {}),
    };
    this.onStatusChange?.(this.current);
    return this.current;
  }
}
