import path from 'node:path';

export const APP_NAME = 'Herdr Desktop';
export const APP_DESCRIPTION =
  'A native workspace for Herdr-powered agents, terminals, worktrees, and live sessions.';

interface BrandingTarget {
  dock?: { setIcon(iconPath: string): void };
  getVersion(): string;
  setAboutPanelOptions(options: {
    applicationName: string;
    applicationVersion: string;
    copyright: string;
    credits: string;
  }): void;
  setName(name: string): void;
}

interface BrandingOptions {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesDirectory: string;
}

export function configureApplicationBranding(
  app: BrandingTarget,
  { isPackaged, platform, resourcesDirectory }: BrandingOptions,
): void {
  app.setName(APP_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Herdr Desktop contributors',
    credits: APP_DESCRIPTION,
  });
  if (platform === 'darwin' && !isPackaged) {
    app.dock?.setIcon(path.join(resourcesDirectory, 'icon-1024.png'));
  }
}
