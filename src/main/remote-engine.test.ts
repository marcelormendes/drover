import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { RemoteEngineTunnel, type TunnelChildProcess } from '@/main/remote-engine';

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
  const tunnel = new RemoteEngineTunnel({
    createBridge,
    socketPath: '/tmp/herdr-test-remote.sock',
    sshSpawn,
  });
  return { bridgeClose, createBridge, sshSpawn, tunnel };
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

  it('reports an error when the SSH process exits unexpectedly', async () => {
    const { sshSpawn, tunnel } = setup();
    await tunnel.apply(target);
    const child = sshSpawn.mock.results[0].value;
    child.emit('exit', 255);
    expect(tunnel.status.state).toBe('error');
    expect(tunnel.status.message).toMatch(/SSH tunnel exited/);
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
