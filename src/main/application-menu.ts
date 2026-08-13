import type { MenuItemConstructorOptions } from 'electron';

import type { DesktopAction } from '@/shared/desktop-api';

export function applicationMenuTemplate(
  platform: NodeJS.Platform,
  onAction: (action: DesktopAction) => void,
): MenuItemConstructorOptions[] {
  const action = (
    label: string,
    desktopAction: DesktopAction,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    label,
    ...(accelerator ? { accelerator } : {}),
    click: () => onAction(desktopAction),
  });
  const settings: MenuItemConstructorOptions = {
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => onAction('open-settings'),
  };
  const firstMenu: MenuItemConstructorOptions =
    platform === 'darwin'
      ? {
          label: 'Drover',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            settings,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }
      : {
          label: 'File',
          submenu: [settings, { type: 'separator' }, { role: 'quit' }],
        };

  return [
    firstMenu,
    {
      label: 'Session',
      submenu: [
        action('Open Navigator…', 'open-navigator', 'CmdOrCtrl+K'),
        action('Open Plugins…', 'open-plugins', 'CmdOrCtrl+Shift+P'),
        action('Refresh Herdr Session', 'refresh', 'CmdOrCtrl+R'),
        action('Reload Herdr Configuration', 'reload-config', 'CmdOrCtrl+Shift+R'),
        { type: 'separator' },
        action("What's New…", 'open-whats-new'),
        { type: 'separator' },
        { label: 'Detach Desktop', role: 'close' },
      ],
    },
    {
      label: 'Workspace',
      submenu: [
        action('New Workspace', 'new-workspace', 'CmdOrCtrl+Shift+N'),
        { type: 'separator' },
        action('Previous Workspace', 'previous-workspace', 'Ctrl+Shift+Tab'),
        action('Next Workspace', 'next-workspace', 'Ctrl+Tab'),
      ],
    },
    {
      label: 'Tab',
      submenu: [
        action('New Tab', 'new-tab', 'CmdOrCtrl+T'),
        { type: 'separator' },
        action('Previous Tab', 'previous-tab', 'CmdOrCtrl+Alt+Left'),
        action('Next Tab', 'next-tab', 'CmdOrCtrl+Alt+Right'),
      ],
    },
    {
      label: 'Pane',
      submenu: [
        action('Focus Left', 'focus-pane-left', 'Alt+Left'),
        action('Focus Right', 'focus-pane-right', 'Alt+Right'),
        action('Focus Up', 'focus-pane-up', 'Alt+Up'),
        action('Focus Down', 'focus-pane-down', 'Alt+Down'),
        { type: 'separator' },
        action('Split Right', 'split-pane-right', 'CmdOrCtrl+Alt+V'),
        action('Split Down', 'split-pane-down', 'CmdOrCtrl+Alt+-'),
        action('Toggle Zoom', 'toggle-pane-zoom', 'CmdOrCtrl+Shift+Z'),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom', accelerator: 'CmdOrCtrl+0' },
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+Plus', visible: false },
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+numadd', visible: false },
        { role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
        { role: 'zoomOut', accelerator: 'CmdOrCtrl+_', visible: false },
        { role: 'zoomOut', accelerator: 'CmdOrCtrl+numsub', visible: false },
        { role: 'resetZoom', accelerator: 'CmdOrCtrl+num0', visible: false },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        action('Keyboard Shortcuts…', 'open-shortcuts', 'CmdOrCtrl+?'),
        action("What's New…", 'open-whats-new'),
      ],
    },
  ];
}
