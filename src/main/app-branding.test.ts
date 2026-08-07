import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { APP_DESCRIPTION, APP_NAME, configureApplicationBranding } from '@/main/app-branding';

function makeApp() {
  return {
    dock: { setIcon: vi.fn() },
    getVersion: vi.fn(() => '0.1.5'),
    setAboutPanelOptions: vi.fn(),
    setName: vi.fn(),
  };
}

describe('configureApplicationBranding', () => {
  it('sets the Herdr name and About description', () => {
    const app = makeApp();

    configureApplicationBranding(app, {
      isPackaged: true,
      platform: 'darwin',
      resourcesDirectory: '/repo/resources',
    });

    expect(app.setName).toHaveBeenCalledWith(APP_NAME);
    expect(app.setAboutPanelOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationName: APP_NAME,
        applicationVersion: '0.1.5',
        credits: APP_DESCRIPTION,
      }),
    );
  });

  it('replaces the Electron Dock icon during macOS development', () => {
    const app = makeApp();

    configureApplicationBranding(app, {
      isPackaged: false,
      platform: 'darwin',
      resourcesDirectory: '/repo/resources',
    });

    expect(app.dock.setIcon).toHaveBeenCalledWith(path.join('/repo/resources', 'icon-1024.png'));
  });

  it('keeps the embedded package icon outside macOS development', () => {
    const packaged = makeApp();
    const linux = makeApp();

    configureApplicationBranding(packaged, {
      isPackaged: true,
      platform: 'darwin',
      resourcesDirectory: '/repo/resources',
    });
    configureApplicationBranding(linux, {
      isPackaged: false,
      platform: 'linux',
      resourcesDirectory: '/repo/resources',
    });

    expect(packaged.dock.setIcon).not.toHaveBeenCalled();
    expect(linux.dock.setIcon).not.toHaveBeenCalled();
  });
});
