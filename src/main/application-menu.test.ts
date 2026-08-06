import { describe, expect, it, vi } from 'vitest';

import { applicationMenuTemplate } from '@/main/application-menu';

describe('applicationMenuTemplate', () => {
  it('routes native desktop accelerators to renderer-owned Herdr actions', () => {
    const onAction = vi.fn();
    const template = applicationMenuTemplate('darwin', onAction);
    const appMenu = template.find((item) => item.label === 'Herdr Desktop');
    const sessionMenu = template.find((item) => item.label === 'Session');
    const workspaceMenu = template.find((item) => item.label === 'Workspace');
    const paneMenu = template.find((item) => item.label === 'Pane');
    const helpMenu = template.find((item) => item.label === 'Help');
    const settings = Array.isArray(appMenu?.submenu)
      ? appMenu.submenu.find((item) => 'label' in item && item.label === 'Settings…')
      : undefined;
    const refresh = Array.isArray(sessionMenu?.submenu)
      ? sessionMenu.submenu.find(
          (item) => 'label' in item && item.label === 'Refresh Herdr Session',
        )
      : undefined;
    const navigator = Array.isArray(sessionMenu?.submenu)
      ? sessionMenu.submenu.find((item) => 'label' in item && item.label === 'Open Navigator…')
      : undefined;
    const plugins = Array.isArray(sessionMenu?.submenu)
      ? sessionMenu.submenu.find((item) => 'label' in item && item.label === 'Open Plugins…')
      : undefined;
    const newWorkspace = Array.isArray(workspaceMenu?.submenu)
      ? workspaceMenu.submenu.find((item) => 'label' in item && item.label === 'New Workspace')
      : undefined;
    const focusLeft = Array.isArray(paneMenu?.submenu)
      ? paneMenu.submenu.find((item) => 'label' in item && item.label === 'Focus Left')
      : undefined;
    const shortcuts = Array.isArray(helpMenu?.submenu)
      ? helpMenu.submenu.find((item) => 'label' in item && item.label === 'Keyboard Shortcuts…')
      : undefined;

    expect(settings).toMatchObject({ accelerator: 'CmdOrCtrl+,' });
    expect(refresh).toMatchObject({ accelerator: 'CmdOrCtrl+R' });
    expect(navigator).toMatchObject({ accelerator: 'CmdOrCtrl+K' });
    expect(plugins).toMatchObject({ accelerator: 'CmdOrCtrl+Shift+P' });
    expect(newWorkspace).toMatchObject({ accelerator: 'CmdOrCtrl+Shift+N' });
    if (
      typeof settings?.click !== 'function' ||
      typeof refresh?.click !== 'function' ||
      typeof navigator?.click !== 'function' ||
      typeof plugins?.click !== 'function' ||
      typeof newWorkspace?.click !== 'function' ||
      typeof focusLeft?.click !== 'function' ||
      typeof shortcuts?.click !== 'function'
    ) {
      throw new Error('Expected actionable desktop menu items.');
    }
    (settings.click as () => void)();
    (refresh.click as () => void)();
    (navigator.click as () => void)();
    (plugins.click as () => void)();
    (newWorkspace.click as () => void)();
    (focusLeft.click as () => void)();
    (shortcuts.click as () => void)();
    expect(onAction).toHaveBeenNthCalledWith(1, 'open-settings');
    expect(onAction).toHaveBeenNthCalledWith(2, 'refresh');
    expect(onAction).toHaveBeenNthCalledWith(3, 'open-navigator');
    expect(onAction).toHaveBeenNthCalledWith(4, 'open-plugins');
    expect(onAction).toHaveBeenNthCalledWith(5, 'new-workspace');
    expect(onAction).toHaveBeenNthCalledWith(6, 'focus-pane-left');
    expect(onAction).toHaveBeenNthCalledWith(7, 'open-shortcuts');
  });
});
