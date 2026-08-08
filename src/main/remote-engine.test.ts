import { EventEmitter } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  createRemoteEngineRelauncher,
  createWillQuitHandler,
  establishPersistedRemoteEngineBeforeWindow,
  type RemoteEngineRelaunchOptions,
  RemoteEngineTunnel,
  shouldApplyLocalFallback,
  type TunnelChildProcess,
} from '@/main/remote-engine';
import { DEFAULT_DESKTOP_PREFERENCES } from '@/shared/preferences';

type FakeChild = TunnelChildProcess & {
  emit: (event: string, ...args: unknown[]) => boolean;
  pid: number;
};

function fakeChild(): FakeChild {
  const child = new EventEmitter() as unknown as FakeChild;
  child.kill = vi.fn(() => true);
  child.pid = 4242;
  return child;
}

type SpawnCall = (command: string, args: string[], options: { stdio: 'ignore' }) => FakeChild;

function setup() {
  const sshSpawn = vi.fn<SpawnCall>(() => fakeChild());
  const bridgeClose = vi.fn();
  const createBridge = vi.fn(async () => ({ close: bridgeClose }));
  const onStatusChange = vi.fn();
  const tunnel = new RemoteEngineTunnel({
    createBridge,
    onStatusChange,
    socketPath: '/tmp/herdr-test-remote.sock',
    clientSocketPath: '/tmp/herdr-test-remote-client.sock',
    sshSpawn,
    waitForForwarding: async () => undefined,
  });
  return { bridgeClose, createBridge, onStatusChange, sshSpawn, tunnel };
}

const target = { enabled: true, host: 'user@host', port: 22025 };

async function unusedTcpPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Could not allocate a test TCP port.');
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

describe('RemoteEngineTunnel', () => {
  it('starts off with no tunnel', () => {
    const { tunnel } = setup();
    expect(tunnel.status.state).toBe('off');
    expect(tunnel.status.socketPath).toBeUndefined();
    expect(tunnel.active).toBe(false);
  });

  it('apply(off) tears down without spawning anything', async () => {
    const { sshSpawn, tunnel } = setup();
    const status = await tunnel.apply({ enabled: false, host: 'user@host', port: 22025 });
    expect(status.state).toBe('off');
    expect(sshSpawn).not.toHaveBeenCalled();
  });

  it('spawns ssh and the bridge for a valid target', async () => {
    const { createBridge, sshSpawn, tunnel } = setup();
    const status = await tunnel.apply(target);
    expect(sshSpawn).toHaveBeenCalledTimes(1);
    expect(sshSpawn.mock.calls[0][0]).toBe('ssh');
    expect(sshSpawn.mock.calls[0][1]).toContain('-N');
    expect(sshSpawn.mock.calls[0][1]).toContain('-L');
    expect(sshSpawn.mock.calls[0][1]).toContain('22025:127.0.0.1:22025');
    expect(sshSpawn.mock.calls[0][1]).toContain('22026:127.0.0.1:22026');
    expect(sshSpawn.mock.calls[0][1]).toContain('user@host');
    expect(sshSpawn.mock.calls[0][1]).toContain('ExitOnForwardFailure=yes');
    expect(createBridge).toHaveBeenCalledWith('/tmp/herdr-test-remote.sock', 22025);
    expect(createBridge).toHaveBeenCalledWith('/tmp/herdr-test-remote-client.sock', 22026);
    expect(status.state).toBe('starting');
    expect(status.socketPath).toBe('/tmp/herdr-test-remote.sock');
    expect(status.clientSocketPath).toBe('/tmp/herdr-test-remote-client.sock');
    expect(tunnel.active).toBe(true);
  });

  it('creates and cleans up API and client socket bridges', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'herdr-remote-engine-'));
    const socketPath = path.join(directory, 'herdr.sock');
    const clientSocketPath = path.join(directory, 'herdr-client.sock');
    const tunnel = new RemoteEngineTunnel({
      clientSocketPath,
      socketPath,
      sshSpawn: vi.fn<SpawnCall>(() => fakeChild()),
      waitForForwarding: async () => undefined,
    });

    try {
      const status = await tunnel.apply({ ...target, port: await unusedTcpPort() });
      expect(status).toMatchObject({ socketPath, clientSocketPath });
      await expect(access(socketPath)).resolves.toBeUndefined();
      await expect(access(clientSocketPath)).resolves.toBeUndefined();

      await tunnel.stop();
      await expect(access(socketPath)).rejects.toThrow();
      await expect(access(clientSocketPath)).rejects.toThrow();
    } finally {
      await tunnel.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects an empty SSH target', async () => {
    const { sshSpawn, tunnel } = setup();
    const status = await tunnel.apply({ enabled: true, host: '   ', port: 22025 });
    expect(status.state).toBe('error');
    expect(status.message).toMatch(/SSH target/);
    expect(sshSpawn).not.toHaveBeenCalled();
    expect(tunnel.active).toBe(false);
  });

  it('rejects invalid ports', async () => {
    const { sshSpawn, tunnel } = setup();
    for (const port of [0, 65535, 70000, 22.5, Number.NaN]) {
      const status = await tunnel.apply({ enabled: true, host: 'user@host', port });
      expect(status.state).toBe('error');
      expect(status.message).toMatch(/Port/);
    }
    expect(sshSpawn).not.toHaveBeenCalled();
  });

  it('reports an error when the bridge cannot listen', async () => {
    const { sshSpawn } = setup();
    const failing = new RemoteEngineTunnel({
      createBridge: vi.fn(async () => {
        throw new Error('EADDRINUSE');
      }),
      socketPath: '/tmp/herdr-test-remote.sock',
      sshSpawn,
    });
    const status = await failing.apply(target);
    expect(status.state).toBe('error');
    expect(status.message).toMatch(/bridge/);
    expect(sshSpawn).not.toHaveBeenCalled();
  });

  it('reports an error when the SSH process exits unexpectedly and cleans up', async () => {
    const { bridgeClose, sshSpawn, tunnel } = setup();
    await tunnel.apply(target);
    const child = sshSpawn.mock.results[0].value;
    child.emit('exit', 255);
    await vi.waitFor(() => expect(tunnel.status.state).toBe('error'));
    expect(tunnel.status.message).toMatch(/SSH tunnel exited/);
    expect(bridgeClose).toHaveBeenCalled();
    expect(tunnel.active).toBe(false);
    expect(tunnel.status.socketPath).toBeUndefined();
  });

  it('marks the tunnel connected after a successful bootstrap', async () => {
    const { tunnel } = setup();
    await tunnel.apply(target);
    const status = tunnel.setConnected(true);
    expect(status.state).toBe('connected');
    expect(tunnel.active).toBe(true);
  });

  it('marks the tunnel errored when the bootstrap cannot reach the server', async () => {
    const { tunnel } = setup();
    await tunnel.apply(target);
    const status = tunnel.setConnected(false, 'Remote engine unreachable.');
    expect(status.state).toBe('error');
    expect(status.message).toBe('Remote engine unreachable.');
  });

  it('stop kills the SSH process, closes the bridge, and returns to off', async () => {
    const { bridgeClose, sshSpawn, tunnel } = setup();
    await tunnel.apply(target);
    const child = sshSpawn.mock.results[0].value;
    await tunnel.stop();
    expect(child.kill).toHaveBeenCalled();
    expect(bridgeClose).toHaveBeenCalled();
    expect(tunnel.status.state).toBe('off');
    expect(tunnel.active).toBe(false);
  });

  it('re-applying tears down the previous tunnel first', async () => {
    const { sshSpawn, tunnel } = setup();
    await tunnel.apply(target);
    const first = sshSpawn.mock.results[0].value;
    await tunnel.apply({ ...target, host: 'other@host' });
    expect(first.kill).toHaveBeenCalled();
    expect(sshSpawn).toHaveBeenCalledTimes(2);
    expect(sshSpawn.mock.calls[1][1]).toContain('other@host');
  });

  it('waits for the SSH forwarding port before resolving apply', async () => {
    const port = await unusedTcpPort();
    const servers = [net.createServer(), net.createServer()];
    const child = fakeChild();
    const sshSpawn = vi.fn<SpawnCall>(() => {
      setTimeout(() => {
        servers[0].listen(port, '127.0.0.1');
        servers[1].listen(port + 1, '127.0.0.1');
      }, 20);
      return child;
    });
    const tunnel = new RemoteEngineTunnel({
      createBridge: vi.fn(async () => ({ close: vi.fn() })),
      socketPath: '/tmp/herdr-test-remote-readiness.sock',
      sshSpawn,
    });

    let settled = false;
    const applying = tunnel.apply({ ...target, port }).then((status) => {
      settled = true;
      return status;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    await expect(applying).resolves.toMatchObject({ state: 'starting', port });
    expect(settled).toBe(true);
    await tunnel.stop();
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
  });

  it('returns an SSH failure when forwarding exits before becoming ready', async () => {
    const child = fakeChild();
    const sshSpawn = vi.fn<SpawnCall>(() => {
      queueMicrotask(() => child.emit('exit', 255));
      return child;
    });
    const tunnel = new RemoteEngineTunnel({
      createBridge: vi.fn(async () => ({ close: vi.fn() })),
      socketPath: '/tmp/herdr-test-remote-exit.sock',
      sshSpawn,
    });

    await expect(tunnel.apply({ ...target, port: await unusedTcpPort() })).resolves.toMatchObject({
      state: 'error',
      message: expect.stringMatching(/SSH tunnel exited/),
    });
  });
});

describe('RemoteEngineTunnel lifecycle hardening', () => {
  it('removes the socket file and closes the bridge when the SSH process dies', async () => {
    const { writeFile, rm } = await import('node:fs/promises');
    const socketPath = '/tmp/herdr-test-remote-failure.sock';
    await writeFile(socketPath, 'stale');
    const bridgeClose = vi.fn();
    const sshSpawn = vi.fn<SpawnCall>(() => fakeChild());
    const tunnel = new RemoteEngineTunnel({
      createBridge: vi.fn(async () => ({ close: bridgeClose })),
      socketPath,
      sshSpawn,
      waitForForwarding: async () => undefined,
    });
    await tunnel.apply(target);
    const child = sshSpawn.mock.results[0].value;
    child.emit('exit', 255);
    await vi.waitFor(() => expect(bridgeClose).toHaveBeenCalled());
    await expect(
      import('node:fs/promises').then(({ access }) => access(socketPath)),
    ).rejects.toThrow();
    await rm(socketPath, { force: true }).catch(() => undefined);
  });

  it('serializes concurrent applies so the newest request wins', async () => {
    let releaseBridge!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseBridge = resolve;
    });
    const sshSpawn = vi.fn<SpawnCall>(() => fakeChild());
    const tunnel = new RemoteEngineTunnel({
      createBridge: vi.fn(async () => {
        await gate;
        return { close: vi.fn() };
      }),
      socketPath: '/tmp/herdr-test-remote.sock',
      sshSpawn,
      waitForForwarding: async () => undefined,
    });
    const first = tunnel.apply({ ...target, host: 'slow@host' });
    const second = tunnel.apply({ enabled: false, host: 'slow@host', port: 22025 });
    releaseBridge();
    await Promise.all([first, second]);
    expect(sshSpawn).toHaveBeenCalledTimes(1);
    expect(tunnel.status.state).toBe('off');
    expect(tunnel.active).toBe(false);
  });

  it('notifies the status listener on every transition', async () => {
    const { onStatusChange, sshSpawn, tunnel } = setup();
    await tunnel.apply(target);
    expect(onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'starting' }));
    tunnel.setConnected(true);
    expect(onStatusChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'connected' }),
    );
    await tunnel.stop();
    expect(onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'off' }));
    const child = sshSpawn.mock.results[0].value;
    child.emit('exit', 0);
    expect(tunnel.status.state).toBe('off');
  });

  it('stop is idempotent', async () => {
    const { tunnel } = setup();
    await tunnel.apply(target);
    await tunnel.stop();
    await tunnel.stop();
    expect(tunnel.status.state).toBe('off');
  });
});

describe('RemoteEngineTunnel shutdown and pending work', () => {
  it('is active while the bridge is still being created', async () => {
    let releaseBridge!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseBridge = resolve;
    });
    const sshSpawn = vi.fn<SpawnCall>(() => fakeChild());
    const tunnel = new RemoteEngineTunnel({
      createBridge: vi.fn(async () => {
        await gate;
        return { close: vi.fn() };
      }),
      socketPath: '/tmp/herdr-test-remote.sock',
      sshSpawn,
      waitForForwarding: async () => undefined,
    });
    const pending = tunnel.apply(target);
    await vi.waitFor(() => expect(tunnel.active).toBe(true));
    releaseBridge();
    await pending;
  });

  it('never spawns SSH after a stop that raced an in-flight apply', async () => {
    let releaseBridge!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseBridge = resolve;
    });
    const sshSpawn = vi.fn<SpawnCall>(() => fakeChild());
    const tunnel = new RemoteEngineTunnel({
      createBridge: vi.fn(async () => {
        await gate;
        return { close: vi.fn() };
      }),
      socketPath: '/tmp/herdr-test-remote.sock',
      sshSpawn,
      waitForForwarding: async () => undefined,
    });
    const pending = tunnel.apply(target);
    const stopping = tunnel.stop();
    releaseBridge();
    await Promise.all([pending, stopping]);
    expect(tunnel.status.state).toBe('off');
    const spawns = sshSpawn.mock.calls.length;
    await tunnel.stop();
    expect(sshSpawn.mock.calls.length).toBe(spawns);
    expect(tunnel.status.state).toBe('off');
  });
});

describe('RemoteEngineTunnel status guards', () => {
  it('never transitions a setup error into connected', async () => {
    const { tunnel } = setup();
    await tunnel.apply({ enabled: true, host: '   ', port: 22025 });
    expect(tunnel.status.state).toBe('error');
    const status = tunnel.setConnected(true);
    expect(status.state).toBe('error');
    expect(tunnel.active).toBe(false);
  });

  it('never transitions a bridge failure into connected', async () => {
    const sshSpawn = vi.fn<SpawnCall>(() => fakeChild());
    const tunnel = new RemoteEngineTunnel({
      createBridge: vi.fn(async () => {
        throw new Error('EADDRINUSE');
      }),
      socketPath: '/tmp/herdr-test-remote.sock',
      sshSpawn,
    });
    await tunnel.apply(target);
    expect(tunnel.status.state).toBe('error');
    expect(tunnel.setConnected(true).state).toBe('error');
    expect(sshSpawn).not.toHaveBeenCalled();
  });
});

describe('createWillQuitHandler', () => {
  it('prevents the first quit, stops the tunnel, and quits after cleanup', async () => {
    let resolveStop!: () => void;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStop = resolve;
        }),
    );
    const quit = vi.fn();
    const handler = createWillQuitHandler({ quit, stop });
    const event = { preventDefault: vi.fn() };

    handler(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();

    // A second quit while cleanup is still running is deduplicated.
    const event2 = { preventDefault: vi.fn() };
    handler(event2);
    expect(event2.preventDefault).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);

    resolveStop();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));

    // Once cleanup finished, the retried quit proceeds without prevention.
    const event3 = { preventDefault: vi.fn() };
    handler(event3);
    expect(event3.preventDefault).not.toHaveBeenCalled();
  });

  it('still quits when the cleanup rejects', async () => {
    const stop = vi.fn(async () => {
      throw new Error('stop failed');
    });
    const quit = vi.fn();
    const handler = createWillQuitHandler({ quit, stop });
    handler({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    const retry = { preventDefault: vi.fn() };
    handler(retry);
    expect(retry.preventDefault).not.toHaveBeenCalled();
  });
});

describe('shouldApplyLocalFallback', () => {
  it('only commits the local fallback when no newer apply superseded it', () => {
    expect(shouldApplyLocalFallback(1, 1, false)).toBe(true);
    expect(shouldApplyLocalFallback(1, 2, false)).toBe(false);
    expect(shouldApplyLocalFallback(1, 1, true)).toBe(false);
  });
});

describe('remote-engine relaunch boundary', () => {
  it('persists the target before one deduplicated full-app relaunch', async () => {
    const order: string[] = [];
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const relaunch = vi.fn(() => order.push('relaunch'));
    const quit = vi.fn(() => order.push('quit'));
    const persistTarget = vi.fn(async (_persistedTarget) => {
      order.push('persist');
      await writeGate;
    });
    const request = createRemoteEngineRelauncher({
      persistTarget,
      relaunch,
      quit,
    });

    const first = request({ enabled: true, host: 'user@remote', port: 22025 });
    const second = request({ enabled: true, host: 'other@remote', port: 22025 });
    expect(second).toBe(first);
    expect(order).toEqual(['persist']);
    expect(relaunch).not.toHaveBeenCalled();

    releaseWrite();
    await expect(first).resolves.toMatchObject({ state: 'starting' });
    expect(order).toEqual(['persist', 'relaunch', 'quit']);
    expect(persistTarget).toHaveBeenCalledWith({
      enabled: true,
      host: 'user@remote',
      port: 22025,
    });
    expect(relaunch).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });

  it('allows a later relaunch when target persistence fails', async () => {
    const persistTarget = vi
      .fn<RemoteEngineRelaunchOptions['persistTarget']>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);
    const relaunch = vi.fn();
    const quit = vi.fn();
    const request = createRemoteEngineRelauncher({ persistTarget, relaunch, quit });

    await expect(request(target)).rejects.toThrow('disk full');
    await expect(request(target)).resolves.toMatchObject({ state: 'starting' });
    expect(persistTarget).toHaveBeenCalledTimes(2);
    expect(relaunch).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });
});

describe('persisted remote-engine startup', () => {
  it('establishes the persisted remote engine before creating the renderer window', async () => {
    const order: string[] = [];
    let releaseApply!: () => void;
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const establish = vi.fn(async () => {
      order.push('establish');
      await applyGate;
      order.push('established');
    });
    const createWindow = vi.fn(() => order.push('window'));

    const starting = establishPersistedRemoteEngineBeforeWindow(
      { ...DEFAULT_DESKTOP_PREFERENCES, remoteEngine: target },
      establish,
      createWindow,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['establish']);
    expect(createWindow).not.toHaveBeenCalled();

    releaseApply();
    await starting;
    expect(order).toEqual(['establish', 'established', 'window']);
    expect(establish).toHaveBeenCalledWith(target);
    expect(createWindow).toHaveBeenCalledOnce();
  });

  it('clears inherited remote socket overrides before creating a local window', async () => {
    const previousApiSocket = process.env.HERDR_SOCKET_PATH;
    const previousClientSocket = process.env.HERDR_CLIENT_SOCKET_PATH;
    process.env.HERDR_SOCKET_PATH = '/tmp/inherited-remote.sock';
    process.env.HERDR_CLIENT_SOCKET_PATH = '/tmp/inherited-remote-client.sock';
    const establish = vi.fn(async () => undefined);
    const createWindow = vi.fn(() => {
      expect(process.env.HERDR_SOCKET_PATH).toBeUndefined();
      expect(process.env.HERDR_CLIENT_SOCKET_PATH).toBeUndefined();
    });

    try {
      await establishPersistedRemoteEngineBeforeWindow(
        DEFAULT_DESKTOP_PREFERENCES,
        establish,
        createWindow,
      );
      expect(establish).not.toHaveBeenCalled();
      expect(createWindow).toHaveBeenCalledOnce();
    } finally {
      if (previousApiSocket === undefined) {
        delete process.env.HERDR_SOCKET_PATH;
      } else {
        process.env.HERDR_SOCKET_PATH = previousApiSocket;
      }
      if (previousClientSocket === undefined) {
        delete process.env.HERDR_CLIENT_SOCKET_PATH;
      } else {
        process.env.HERDR_CLIENT_SOCKET_PATH = previousClientSocket;
      }
    }
  });
});
