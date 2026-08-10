import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stageChatImages } from '@/main/chat-images';
import {
  chatImageStagingDir,
  FLATPAK_APP_ID,
  flatpakHostDataDir,
  flatpakRemoteSocketDir,
  flatpakSandboxConfigDir,
  flatpakSandboxDataDir,
  hostInvocation,
  hostPathFromSandboxPath,
  isFlatpakHost,
  sandboxPathFromHostPath,
} from '@/main/flatpak';

const HOST_PATH = '--env=PATH=/home/tester/.local/bin:/usr/local/bin:/usr/bin:/bin';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('isFlatpakHost', () => {
  it('is false outside the Herdr Desktop Flatpak', () => {
    vi.stubEnv('FLATPAK_ID', '');
    expect(isFlatpakHost()).toBe(false);

    vi.unstubAllEnvs();
    expect(isFlatpakHost()).toBe(false);
  });

  it('is true only for the Herdr Desktop application ID', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    expect(isFlatpakHost()).toBe(true);

    vi.stubEnv('FLATPAK_ID', 'org.example.other-app');
    expect(isFlatpakHost()).toBe(false);
  });
});

describe('flatpakHostDataDir', () => {
  it('prefers HOST_XDG_DATA_HOME inside the Flatpak', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('HOST_XDG_DATA_HOME', '/custom/host-data');
    expect(flatpakHostDataDir()).toBe('/custom/host-data');
  });

  it('falls back to ~/.local/share when HOST_XDG_DATA_HOME is unset', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('HOST_XDG_DATA_HOME', '');
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    expect(flatpakHostDataDir()).toBe(path.join('/home/tester', '.local', 'share'));
  });
});

describe('flatpakSandboxDataDir and flatpakSandboxConfigDir', () => {
  it('use the sandbox XDG variables', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('XDG_DATA_HOME', '/sandbox-data');
    vi.stubEnv('XDG_CONFIG_HOME', '/sandbox-config');
    expect(flatpakSandboxDataDir()).toBe('/sandbox-data');
    expect(flatpakSandboxConfigDir()).toBe('/sandbox-config');
  });

  it('fall back to the private .var/app data and config bases', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('XDG_DATA_HOME', '');
    vi.stubEnv('XDG_CONFIG_HOME', '');
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    expect(flatpakSandboxDataDir()).toBe(
      path.join('/home/tester', '.var', 'app', FLATPAK_APP_ID, 'data'),
    );
    expect(flatpakSandboxConfigDir()).toBe(
      path.join('/home/tester', '.var', 'app', FLATPAK_APP_ID, 'config'),
    );
  });
});

describe('host and sandbox path translation', () => {
  it('is identity outside Flatpak', () => {
    vi.unstubAllEnvs();
    expect(hostPathFromSandboxPath('/sandbox-data/x')).toBe('/sandbox-data/x');
    expect(sandboxPathFromHostPath('/host-data/x')).toBe('/host-data/x');
  });

  it('translates the xdg-data and xdg-config prefixes in both directions', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('XDG_DATA_HOME', '/sandbox-data');
    vi.stubEnv('XDG_CONFIG_HOME', '/sandbox-config');
    vi.stubEnv('HOST_XDG_DATA_HOME', '/host-data');
    vi.stubEnv('HOST_XDG_CONFIG_HOME', '/host-config');

    expect(hostPathFromSandboxPath('/sandbox-data/herdr-desktop/chat-images/a.png')).toBe(
      '/host-data/herdr-desktop/chat-images/a.png',
    );
    expect(hostPathFromSandboxPath('/sandbox-config/herdr/herdr.sock')).toBe(
      '/host-config/herdr/herdr.sock',
    );
    expect(sandboxPathFromHostPath('/host-data/herdr-desktop/remote/r.sock')).toBe(
      '/sandbox-data/herdr-desktop/remote/r.sock',
    );
    expect(sandboxPathFromHostPath('/host-config/herdr/herdr.sock')).toBe(
      '/sandbox-config/herdr/herdr.sock',
    );
    expect(sandboxPathFromHostPath('/host-data')).toBe('/sandbox-data');
  });

  it('never rewrites sibling prefixes at a segment boundary', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('XDG_DATA_HOME', '/sandbox-data');
    vi.stubEnv('XDG_CONFIG_HOME', '/sandbox-config');
    vi.stubEnv('HOST_XDG_DATA_HOME', '/host-data');
    vi.stubEnv('HOST_XDG_CONFIG_HOME', '/host-config');

    expect(sandboxPathFromHostPath('/host-data-other/x')).toBe('/host-data-other/x');
    expect(sandboxPathFromHostPath('/host-config-extra/y')).toBe('/host-config-extra/y');
    expect(hostPathFromSandboxPath('/sandbox-data-other/x')).toBe('/sandbox-data-other/x');
    expect(hostPathFromSandboxPath('/unrelated/path')).toBe('/unrelated/path');
    expect(hostPathFromSandboxPath('/tmp/herdr-desktop-remote.sock')).toBe(
      '/tmp/herdr-desktop-remote.sock',
    );
  });
});

describe('hostInvocation', () => {
  it('returns the command unchanged outside Flatpak', () => {
    vi.unstubAllEnvs();
    const args = ['--status', '--json'];
    expect(hostInvocation('herdr', args)).toEqual({ program: 'herdr', args });
    expect(hostInvocation('/home/user/.local/bin/herdr', [])).toEqual({
      program: '/home/user/.local/bin/herdr',
      args: [],
    });
  });

  it('prefixes with flatpak-spawn --host, --watch-bus, and a deterministic host PATH', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('HERDR_SOCKET_PATH', '');
    vi.stubEnv('HERDR_CLIENT_SOCKET_PATH', '');
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    expect(hostInvocation('herdr', ['--status'])).toEqual({
      program: 'flatpak-spawn',
      args: ['--host', '--watch-bus', HOST_PATH, 'herdr', '--status'],
    });
  });

  it('omits --watch-bus for detached processes that must outlive the app', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('HERDR_SOCKET_PATH', '');
    vi.stubEnv('HERDR_CLIENT_SOCKET_PATH', '');
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    expect(hostInvocation('herdr', ['server'], { watchBus: false })).toEqual({
      program: 'flatpak-spawn',
      args: ['--host', HOST_PATH, 'herdr', 'server'],
    });
  });

  it('does not prefix for other Flatpak applications', () => {
    vi.stubEnv('FLATPAK_ID', 'org.example.other-app');
    expect(hostInvocation('herdr', ['--status'])).toEqual({
      program: 'herdr',
      args: ['--status'],
    });
  });

  it('forwards the Herdr socket environment variables when present', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    vi.stubEnv('HERDR_SOCKET_PATH', '/host-visible/remote.sock');
    vi.stubEnv('HERDR_CLIENT_SOCKET_PATH', '/host-visible/remote-client.sock');
    expect(hostInvocation('herdr', ['--status']).args).toEqual([
      '--host',
      '--watch-bus',
      HOST_PATH,
      '--env=HERDR_SOCKET_PATH=/host-visible/remote.sock',
      '--env=HERDR_CLIENT_SOCKET_PATH=/host-visible/remote-client.sock',
      'herdr',
      '--status',
    ]);
  });

  it('does not emit empty socket environment arguments', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    vi.stubEnv('HERDR_SOCKET_PATH', '   ');
    expect(hostInvocation('herdr', []).args).not.toContain('--env=HERDR_SOCKET_PATH=   ');
  });

  it('preserves spaces and metacharacters as array elements, never shell text', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('HERDR_SOCKET_PATH', '');
    vi.stubEnv('HERDR_CLIENT_SOCKET_PATH', '');
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    const program = '/path with spaces/herdr v2';
    const args = ['--label', 'a "quoted" pane', '$(touch /tmp/pwned)', 'line\nbreak', '`cmd`'];
    const { program: resolvedProgram, args: resolvedArgs } = hostInvocation(program, args);
    expect(resolvedProgram).toBe('flatpak-spawn');
    expect(resolvedArgs).toEqual(['--host', '--watch-bus', HOST_PATH, program, ...args]);
  });
});

describe('chatImageStagingDir', () => {
  it('uses the temporary directory outside Flatpak', () => {
    vi.unstubAllEnvs();
    expect(chatImageStagingDir()).toBe(path.join(os.tmpdir(), 'herdr-desktop-chat-images'));
  });

  it('stages at the sandbox XDG_DATA_HOME inside the Herdr Desktop Flatpak', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('XDG_DATA_HOME', '/sandbox-data');
    expect(chatImageStagingDir()).toBe(path.join('/sandbox-data', 'herdr-desktop', 'chat-images'));
  });

  it('returns host-visible paths after translation for the renderer and agent', () => {
    const sandboxData = mkdtempSync(path.join(tmpdir(), 'fp-sandbox-data-'));
    const hostData = mkdtempSync(path.join(tmpdir(), 'fp-host-data-'));
    try {
      vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
      vi.stubEnv('XDG_DATA_HOME', sandboxData);
      vi.stubEnv('HOST_XDG_DATA_HOME', hostData);
      const staged = stageChatImages(chatImageStagingDir(), [
        { extension: 'png', data: Buffer.from('hello').toString('base64') },
      ]);
      const hostVisible = staged.map((filePath) => hostPathFromSandboxPath(filePath));
      expect(hostVisible.length).toBe(1);
      expect(hostVisible[0]).toMatch(
        new RegExp(`^${hostData}/herdr-desktop/chat-images/herdr-desktop-chat-[\\d-]+\\.png$`),
      );
      expect(existsSync(staged[0])).toBe(true);
    } finally {
      rmSync(sandboxData, { recursive: true, force: true });
      rmSync(hostData, { recursive: true, force: true });
    }
  });
});

describe('flatpakRemoteSocketDir', () => {
  it('places remote bridge sockets under the sandbox remote grant directory', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('XDG_DATA_HOME', '/sandbox-data');
    expect(flatpakRemoteSocketDir()).toBe(path.join('/sandbox-data', 'herdr-desktop', 'remote'));
  });
});
