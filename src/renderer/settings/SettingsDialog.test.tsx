import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingsDialog } from '@/renderer/settings/SettingsDialog';
import { DEFAULT_DESKTOP_PREFERENCES } from '@/shared/preferences';

describe('SettingsDialog', () => {
  it('covers the TUI settings sections and routes changes to finite callbacks', async () => {
    const user = userEvent.setup();
    const onPreferencesChange = vi.fn();
    const onInstallIntegration = vi.fn();
    const onUninstallIntegration = vi.fn();
    const onReloadConfig = vi.fn();
    const onReloadManifests = vi.fn();
    render(
      <SettingsDialog
        binary="/usr/local/bin/herdr"
        busy={false}
        integrations={[
          { id: 'codex', label: 'Codex', status: 'current' },
          { id: 'claude', label: 'Claude', status: 'missing' },
        ]}
        manifestStatus="ready"
        manifests={[
          {
            agent: 'codex',
            source: 'bundled',
            source_kind: 'bundled',
            active_version: '1.2.3',
            local_override_shadowing_remote: false,
          },
        ]}
        onChooseBinary={vi.fn()}
        onInstallIntegration={onInstallIntegration}
        onOpenChange={vi.fn()}
        onPreferencesChange={onPreferencesChange}
        onReloadConfig={onReloadConfig}
        onReloadManifests={onReloadManifests}
        onResetBinary={vi.fn()}
        onUninstallIntegration={onUninstallIntegration}
        open
        preferences={DEFAULT_DESKTOP_PREFERENCES}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    for (const section of [
      'Appearance',
      'Status indicators',
      'Sound',
      'Notifications',
      'Pane labels',
      'Integrations',
      'Agent manifests',
    ]) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument();
    }

    await user.click(screen.getByRole('switch', { name: 'Play notification sounds' }));
    expect(onPreferencesChange).toHaveBeenCalledWith({
      ...DEFAULT_DESKTOP_PREFERENCES,
      sound: false,
    });

    await user.click(screen.getByRole('button', { name: 'Install Claude integration' }));
    expect(onInstallIntegration).toHaveBeenCalledWith('claude');
    await user.click(screen.getByRole('button', { name: 'Uninstall Codex integration' }));
    expect(onUninstallIntegration).toHaveBeenCalledWith('codex');
    await user.click(screen.getByRole('button', { name: 'Reload Herdr configuration' }));
    expect(onReloadConfig).toHaveBeenCalledOnce();
    expect(screen.getByText('codex')).toBeInTheDocument();
    expect(screen.getByText('v1.2.3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload agent manifests' }));
    expect(onReloadManifests).toHaveBeenCalledOnce();
  });
});
