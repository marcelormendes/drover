import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FLATPAK_APP_ID } from '@/main/flatpak';
import { NodeHerdrCommandRunner, NodeHerdrServerLauncher } from '@/main/herdr/engine';

vi.mock('node:child_process', () => {
  const execFileMock = vi.fn();
  const spawnMock = vi.fn();
  const mock = { execFile: execFileMock, spawn: spawnMock };
  return { default: mock, ...mock };
});

const execFileMock = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;
const spawnMock = vi.mocked(spawn) as unknown as ReturnType<typeof vi.fn>;

function fakeSpawnedChild(): EventEmitter & { unref: () => void } {
  const child = new EventEmitter() as EventEmitter & { unref: () => void };
  child.unref = vi.fn();
  return child;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  execFileMock.mockReset();
  spawnMock.mockReset();
});

describe('Herdr command runner host boundary', () => {
  it('runs the binary unchanged outside Flatpak', async () => {
    execFileMock.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _options: unknown,
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        callback(null, 'out', 'err');
        return undefined;
      },
    );

    const runner = new NodeHerdrCommandRunner('/usr/local/bin/herdr');
    await runner.run(['--status', '--json']);

    expect(execFileMock).toHaveBeenCalledWith(
      '/usr/local/bin/herdr',
      ['--status', '--json'],
      expect.objectContaining({ encoding: 'utf8', timeout: 15_000 }),
      expect.any(Function),
    );
  });

  it('prefixes commands with flatpak-spawn --host inside the Herdr Desktop Flatpak', async () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('HERDR_SOCKET_PATH', '');
    vi.stubEnv('HERDR_CLIENT_SOCKET_PATH', '');
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    execFileMock.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _options: unknown,
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        callback(null, '{}', '');
        return undefined;
      },
    );

    const runner = new NodeHerdrCommandRunner('/usr/local/bin/herdr');
    await runner.run(['update', '--handoff']);

    expect(execFileMock).toHaveBeenCalledWith(
      'flatpak-spawn',
      [
        '--host',
        '--watch-bus',
        '--env=PATH=/home/tester/.local/bin:/usr/local/bin:/usr/bin:/bin',
        '/usr/local/bin/herdr',
        'update',
        '--handoff',
      ],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe('Herdr server launcher host boundary', () => {
  it('spawns the server unchanged outside Flatpak', async () => {
    const child = fakeSpawnedChild();
    spawnMock.mockReturnValue(child);

    const launcher = new NodeHerdrServerLauncher('/usr/local/bin/herdr');
    const launching = launcher.launch();
    child.emit('spawn');
    await launching;

    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/local/bin/herdr',
      ['server'],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
  });

  it('spawns the server through flatpak-spawn --host inside the Herdr Desktop Flatpak', async () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('HERDR_SOCKET_PATH', '');
    vi.stubEnv('HERDR_CLIENT_SOCKET_PATH', '');
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    const child = fakeSpawnedChild();
    spawnMock.mockReturnValue(child);

    const launcher = new NodeHerdrServerLauncher('/usr/local/bin/herdr');
    const launching = launcher.launch();
    child.emit('spawn');
    await launching;

    expect(spawnMock).toHaveBeenCalledWith(
      'flatpak-spawn',
      [
        '--host',
        '--env=PATH=/home/tester/.local/bin:/usr/local/bin:/usr/bin:/bin',
        '/usr/local/bin/herdr',
        'server',
      ],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
  });
});
