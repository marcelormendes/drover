import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AutoUpdater } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUpdateFeed } from '../../scripts/create-update-feed.mjs';
import {
  DesktopInstaller,
  desktopUpdateFeed,
  desktopUpdateUnavailableReason,
} from './desktop-installer';

function setup(reason?: string) {
  const native = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
  });
  const check = vi.fn(async () => ({
    currentVersion: '0.1.30',
    latestVersion: '0.1.31',
    updateAvailable: true,
    releaseUrl: '',
  }));
  const installer = new DesktopInstaller(native as unknown as AutoUpdater, {
    currentVersion: '0.1.30',
    arch: 'arm64',
    unavailableReason: reason,
    check,
  });
  return { native, check, installer };
}

afterEach(() => vi.restoreAllMocks());

describe('native desktop installation', () => {
  it('deduplicates requests, pins architecture and release, and only restarts after download', async () => {
    const { native, check, installer } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = installer.install();
    const failure = expect(first).rejects.toThrow('Restart failed');
    expect(installer.install()).toBe(first);
    await vi.waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledOnce());
    expect(check).toHaveBeenCalledOnce();
    expect(native.setFeedURL).toHaveBeenCalledWith({
      url: 'https://github.com/marcelormendes/drover/releases/download/v0.1.31/drover-macos-arm64.json',
      serverType: 'json',
    });
    expect(native.quitAndInstall).not.toHaveBeenCalled();
    native.emit('update-downloaded');
    await vi.waitFor(() => expect(native.quitAndInstall).toHaveBeenCalledOnce());
    expect(installer.install()).toBe(first);
    expect(native.checkForUpdates).toHaveBeenCalledOnce();
    native.emit('error', new Error('Restart failed'));
    await failure;
  });

  it('handles a synchronous initialization error without starting a download, then permits retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { native, installer } = setup();
    native.setFeedURL.mockImplementationOnce(() =>
      native.emit('error', new Error('Signature invalid')),
    );
    await expect(installer.install()).rejects.toThrow('Signature invalid');
    expect(native.checkForUpdates).not.toHaveBeenCalled();
    const retry = installer.install();
    await vi.waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledOnce());
    const restartFailure = expect(retry).rejects.toThrow('Restart failed');
    native.emit('update-downloaded');
    await vi.waitFor(() => expect(native.quitAndInstall).toHaveBeenCalledOnce());
    native.emit('error', new Error('Restart failed'));
    await restartFailure;
  });

  it('surfaces download failure, removes invocation listeners, and can retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { native, installer } = setup();
    const failed = expect(installer.install()).rejects.toThrow('Network unavailable');
    await vi.waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledOnce());
    native.emit('error', new Error('Network unavailable'));
    await failed;
    expect(native.listenerCount('update-downloaded')).toBe(0);
    expect(native.quitAndInstall).not.toHaveBeenCalled();
    const retry = installer.install();
    await vi.waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledTimes(2));
    const restartFailure = expect(retry).rejects.toThrow('Restart failed');
    native.emit('update-downloaded');
    await vi.waitFor(() => expect(native.quitAndInstall).toHaveBeenCalledOnce());
    native.emit('error', new Error('Restart failed'));
    await restartFailure;
  });

  it('does not redownload when restarting a staged update fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { native, installer } = setup();
    native.quitAndInstall.mockImplementationOnce(() => {
      throw new Error('Restart failed');
    });
    const failed = expect(installer.install()).rejects.toThrow('Restart failed');
    await vi.waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledOnce());
    native.emit('update-downloaded');
    await failed;
    const retry = expect(installer.install()).rejects.toThrow('Still cannot restart');
    expect(native.checkForUpdates).toHaveBeenCalledOnce();
    expect(native.quitAndInstall).toHaveBeenCalledTimes(2);
    native.emit('error', new Error('Still cannot restart'));
    await retry;
  });

  it('reports synchronous native restart errors to recovery and preserves the staged update', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const native = Object.assign(new EventEmitter(), {
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
    });
    const recover = vi.fn();
    const installer = new DesktopInstaller(native as unknown as AutoUpdater, {
      currentVersion: '0.1.30',
      arch: 'arm64',
      onRestartError: recover,
      check: async () => ({
        currentVersion: '0.1.30',
        latestVersion: '0.1.31',
        updateAvailable: true,
        releaseUrl: '',
      }),
    });
    native.quitAndInstall.mockImplementation(() =>
      native.emit('error', new Error('Cannot relaunch')),
    );
    const failure = expect(installer.install()).rejects.toThrow('Cannot relaunch');
    await vi.waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledOnce());
    native.emit('update-downloaded');
    await failure;
    expect(recover).toHaveBeenCalledOnce();
    await expect(installer.install()).rejects.toThrow('Cannot relaunch');
    expect(native.checkForUpdates).toHaveBeenCalledOnce();
  });

  it.each([null, '0.1.30', '0.1.29', 'garbage'])(
    'rejects unavailable or non-newer release %s',
    async (latest) => {
      const { native, installer, check } = setup();
      check.mockResolvedValue({
        currentVersion: '0.1.30',
        latestVersion: latest as string,
        updateAvailable: true,
        releaseUrl: '',
      });
      await expect(installer.install()).rejects.toThrow();
      expect(native.setFeedURL).not.toHaveBeenCalled();
    },
  );

  it('settles when the native updater no longer offers the release', async () => {
    const { native, installer } = setup();
    const failed = expect(installer.install()).rejects.toThrow('no longer available');
    await vi.waitFor(() => expect(native.checkForUpdates).toHaveBeenCalledOnce());
    native.emit('update-not-available');
    await failed;
    expect(native.quitAndInstall).not.toHaveBeenCalled();
  });

  it('blocks unsupported installations before fetching or invoking native APIs', async () => {
    const { native, installer, check } = setup('Installed macOS app required');
    await expect(installer.install()).rejects.toThrow('Installed macOS app required');
    expect(check).not.toHaveBeenCalled();
    expect(native.setFeedURL).not.toHaveBeenCalled();
    expect(desktopUpdateUnavailableReason(true, 'darwin', 'arm64')).toBeUndefined();
    expect(desktopUpdateUnavailableReason(true, 'darwin', 'x64')).toBeUndefined();
    expect(desktopUpdateUnavailableReason(false, 'darwin', 'arm64')).toContain('installed');
    expect(desktopUpdateUnavailableReason(true, 'linux', 'x64')).toContain('package manager');
    expect(desktopUpdateUnavailableReason(true, 'win32', 'x64')).toBeDefined();
  });
});

describe('release update feed', () => {
  it.each(['arm64', 'x64'])(
    'generates the feed consumed by the %s updater with a real archive digest',
    async (arch) => {
      const directory = await mkdtemp(path.join(tmpdir(), 'drover-update-feed-'));
      try {
        await writeFile(path.join(directory, `drover-macos-${arch}.zip`), 'abc');
        const feed = await createUpdateFeed(directory, '0.1.31', arch);
        expect(feed.currentRelease).toBe('0.1.31');
        expect(feed.releases[0].version).toBe(feed.currentRelease);
        expect(feed.releases[0].updateTo).toMatchObject({
          version: '0.1.31',
          url: `https://github.com/marcelormendes/drover/releases/download/v0.1.31/drover-macos-${arch}.zip`,
          size: 3,
          sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        });
        const filename = path.basename(desktopUpdateFeed('0.1.31', arch));
        expect(JSON.parse(await readFile(path.join(directory, filename), 'utf8'))).toEqual(feed);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('rejects malformed feed versions and architectures', () => {
    expect(() => desktopUpdateFeed('../other', 'arm64')).toThrow();
    expect(() => desktopUpdateFeed('0.1.31', 'ia32')).toThrow();
  });
});
