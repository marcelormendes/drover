import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import type {
  RemoteEngineState,
  RemoteEngineStatus,
  RemoteEngineTarget,
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
  /** Local Unix socket the tunnel exposes; defaults to a temp path. */
  socketPath?: string;
}

export function defaultTunnelSocketPath(): string {
  return path.join(os.tmpdir(), 'herdr-desktop-remote.sock');
}

/**
 * Bridges a local Unix socket to a TCP port forwarded over SSH:
 * clients → <socketPath> → 127.0.0.1:<port> → `ssh -L` → remote socat → the
 * remote herdr server's API socket.
 */
export function createTcpBridge(socketPath: string, port: number): Promise<TunnelBridge> {
  return new Promise((resolve, reject) => {
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
 * Owns the SSH tunnel + local socket bridge that make a herdr server on
 * another machine look like the local engine. When active, the caller sets
 * HERDR_SOCKET_PATH to `status.socketPath` so spawned herdr binaries and the
 * API/event clients talk through the tunnel.
 */
export class RemoteEngineTunnel {
  private readonly sshSpawn: NonNullable<RemoteEngineTunnelOptions['sshSpawn']>;
  private readonly createBridge: NonNullable<RemoteEngineTunnelOptions['createBridge']>;
  private readonly socketPath: string;
  private ssh: TunnelChildProcess | null = null;
  private bridge: TunnelBridge | null = null;
  private current: RemoteEngineStatus = {
    state: 'off',
    host: '',
    port: 22025,
  };

  constructor(options: RemoteEngineTunnelOptions = {}) {
    this.sshSpawn = options.sshSpawn ?? spawn;
    this.createBridge = options.createBridge ?? createTcpBridge;
    this.socketPath = options.socketPath ?? defaultTunnelSocketPath();
  }

  get status(): RemoteEngineStatus {
    return this.current;
  }

  get active(): boolean {
    return this.current.state === 'starting' || this.current.state === 'connected';
  }

  async apply({ enabled, host, port }: RemoteEngineTarget): Promise<RemoteEngineStatus> {
    await this.stop();
    const trimmedHost = host.trim();
    this.current = { ...this.current, host: trimmedHost, port };
    if (!enabled) {
      return this.setStatus('off');
    }
    if (!trimmedHost) {
      return this.setStatus('error', 'Enter an SSH target like user@host.');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return this.setStatus('error', 'Port must be between 1 and 65535.');
    }
    try {
      this.bridge = await this.createBridge(this.socketPath, port);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.setStatus('error', `Could not start the local socket bridge: ${message}`);
    }
    const child = this.sshSpawn(
      'ssh',
      [
        '-N',
        '-L',
        `${port}:127.0.0.1:${port}`,
        trimmedHost,
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'ServerAliveInterval=30',
        '-o',
        'ServerAliveCountMax=3',
      ],
      { stdio: 'ignore' },
    );
    child.once('error', (error) => {
      if (this.ssh === child) {
        this.ssh = null;
        this.setStatus('error', `Could not start the SSH tunnel: ${error.message}`);
      }
    });
    child.once('exit', (code) => {
      if (this.ssh === child) {
        this.ssh = null;
        this.setStatus('error', `SSH tunnel exited (code ${code ?? 'unknown'}).`);
      }
    });
    this.ssh = child;
    return this.setStatus('starting', undefined, this.socketPath);
  }

  /** Confirms reachability after the caller bootstraps through the tunnel. */
  setConnected(connected: boolean, message?: string): RemoteEngineStatus {
    if (connected && this.current.state === 'off') {
      return this.current;
    }
    return this.setStatus(connected ? 'connected' : 'error', message);
  }

  async stop(): Promise<void> {
    if (this.ssh) {
      const child = this.ssh;
      this.ssh = null;
      child.kill('SIGTERM');
    }
    if (this.bridge) {
      const bridge = this.bridge;
      this.bridge = null;
      bridge.close();
    }
    await rm(this.socketPath, { force: true });
    this.setStatus('off');
  }

  private setStatus(
    state: RemoteEngineState,
    message?: string,
    socketPath?: string,
  ): RemoteEngineStatus {
    this.current = {
      state,
      host: this.current.host,
      port: this.current.port,
      ...(socketPath ? { socketPath } : {}),
      ...(message !== undefined ? { message } : {}),
    };
    return this.current;
  }
}
