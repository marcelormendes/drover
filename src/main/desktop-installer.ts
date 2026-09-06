import type { AutoUpdater } from 'electron';
import { isNewerVersion } from '@/main/desktop-update';
import type { DesktopUpdateInfo } from '@/shared/desktop-api';

export function desktopUpdateUnavailableReason(
  packaged: boolean,
  platform: NodeJS.Platform,
  arch: string,
): string | undefined {
  if (!packaged) return 'Automatic updates are available in the installed Drover app.';
  if (platform !== 'darwin') {
    return 'This installation must be updated through your package manager or the release download.';
  }
  if (arch !== 'arm64' && arch !== 'x64')
    return 'Automatic updates do not support this architecture.';
  return undefined;
}

/** The renderer never supplies a download URL; only our published, version-pinned feed is used. */
export function desktopUpdateFeed(version: string, arch: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !['arm64', 'x64'].includes(arch)) {
    throw new Error('Invalid desktop update target.');
  }
  return `https://github.com/marcelormendes/drover/releases/download/v${version}/drover-macos-${arch}.json`;
}

/** Owns the native download so repeated renderer requests cannot start duplicate installers. */
export class DesktopInstaller {
  private pending: Promise<void> | null = null;
  private downloaded = false;
  private restarting = false;

  constructor(
    private readonly updater: Pick<
      AutoUpdater,
      'on' | 'once' | 'removeListener' | 'setFeedURL' | 'checkForUpdates' | 'quitAndInstall'
    >,
    private readonly options: {
      currentVersion: string;
      arch: string;
      unavailableReason?: string;
      check: () => Promise<DesktopUpdateInfo>;
      onRestartError?: (error: Error) => void;
    },
  ) {
    // Electron's error event can also arrive after an invocation has settled.
    this.updater.on('error', (error: Error) =>
      console.error('Desktop update failed:', error.message),
    );
  }

  install(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.restarting) return Promise.resolve();
    this.pending = this.run().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async run(): Promise<void> {
    if (this.options.unavailableReason) throw new Error(this.options.unavailableReason);
    if (!this.downloaded) {
      const info = await this.options.check();
      if (!info.latestVersion) throw new Error('Could not check for Drover updates. Try again.');
      if (!isNewerVersion(info.latestVersion, this.options.currentVersion)) {
        throw new Error('No newer Drover update is available.');
      }
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          settled = true;
          this.updater.removeListener('error', failed);
          this.updater.removeListener('update-not-available', unavailable);
          this.updater.removeListener('update-downloaded', ready);
        };
        const failed = (error: Error) => {
          cleanup();
          reject(error);
        };
        const unavailable = () =>
          failed(new Error('The update is no longer available. Check again.'));
        const ready = () => {
          cleanup();
          this.downloaded = true;
          resolve();
        };
        this.updater.once('error', failed);
        this.updater.once('update-not-available', unavailable);
        this.updater.once('update-downloaded', ready);
        try {
          this.updater.setFeedURL({
            url: desktopUpdateFeed(info.latestVersion as string, this.options.arch),
            serverType: 'json',
          });
          if (!settled) this.updater.checkForUpdates();
        } catch (error) {
          failed(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }
    // A successful restart terminates this process. Keep the invocation pending
    // until then so asynchronous native relaunch failures still reach the UI.
    await new Promise<void>((_resolve, reject) => {
      const failed = (error: Error) => {
        this.updater.removeListener('error', failed);
        this.restarting = false;
        reject(error);
        this.options.onRestartError?.(error);
      };
      this.updater.once('error', failed);
      this.restarting = true;
      try {
        this.updater.quitAndInstall();
      } catch (error) {
        failed(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
