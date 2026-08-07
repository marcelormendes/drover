import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  createWillQuitHandler,
  RemoteEngineTunnel,
  shouldApplyLocalFallback,
  type TunnelChildProcess,
} from '@/main/remote-engine';

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
    sshSpawn,
  });
  return { bridgeClose, createBridge, onStatusChange, sshSpawn, tunnel };
}

const target = { enabled: true, host: 'user@host', port: 22025 };

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
    expect(sshSpawn.mock.calls[0][1]).toContain('user@host');
    expect(sshSpawn.mock.calls[0][1]).toContain('ExitOnForwardFailure=yes');
    expect(createBridge).toHaveBeenCalledWith('/tmp/herdr-test-remote.sock', 22025);
    expect(status.state).toBe('starting');
    expect(status.socketPath).toBe('/tmp/herdr-test-remote.sock');
    expect(tunnel.active).toBe(true);
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
    for (const port of [0, 70000, 22.5, Number.NaN]) {
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
