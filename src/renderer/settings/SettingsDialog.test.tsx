import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
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
        onApplyRemoteEngine={vi.fn()}
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
        remoteStatus={{ state: 'off', host: '', port: 22025 }}
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
      'Remote engine',
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

describe('SettingsDialog remote engine section', () => {
  const remoteProps = {
    binary: '/usr/local/bin/herdr',
    busy: false,
    integrations: [],
    manifestStatus: 'ready' as const,
    manifests: [],
    onChooseBinary: vi.fn(),
    onInstallIntegration: vi.fn(),
    onOpenChange: vi.fn(),
    onReloadConfig: vi.fn(),
    onReloadManifests: vi.fn(),
    onResetBinary: vi.fn(),
    onUninstallIntegration: vi.fn(),
    open: true,
  };

  it('shows the remote engine section with the persisted settings', () => {
    render(
      <SettingsDialog
        {...remoteProps}
        onApplyRemoteEngine={vi.fn()}
        onPreferencesChange={vi.fn()}
        preferences={{
          ...DEFAULT_DESKTOP_PREFERENCES,
          remoteEngine: { enabled: true, host: 'user@host', port: 22025 },
        }}
        remoteStatus={{ state: 'connected', host: 'user@host', port: 22025 }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Remote engine' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Use a remote Herdr engine' })).toBeChecked();
    expect(screen.getByLabelText('SSH target')).toHaveValue('user@host');
    expect(screen.getByLabelText('Forwarded port')).toHaveValue(22025);
  });

  it('routes the toggle through preferences and applies the tunnel', async () => {
    const user = userEvent.setup();
    const onPreferencesChange = vi.fn();
    const onApplyRemoteEngine = vi.fn();
    render(
      <SettingsDialog
        {...remoteProps}
        onApplyRemoteEngine={onApplyRemoteEngine}
        onPreferencesChange={onPreferencesChange}
        preferences={DEFAULT_DESKTOP_PREFERENCES}
        remoteStatus={{ state: 'off', host: '', port: 22025 }}
      />,
    );
    await user.click(screen.getByRole('switch', { name: 'Use a remote Herdr engine' }));
    expect(onPreferencesChange).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteEngine: { enabled: true, host: '', port: 22025 },
      }),
    );
    expect(onApplyRemoteEngine).toHaveBeenCalledWith({
      enabled: true,
      host: '',
      port: 22025,
    });
    expect(screen.queryByRole('button', { name: /Reconnect/ })).not.toBeInTheDocument();
  });

  it('applies edited host and port with the reconnect button', async () => {
    const user = userEvent.setup();
    const onApplyRemoteEngine = vi.fn();
    function Harness() {
      const [preferences, setPreferences] = useState({
        ...DEFAULT_DESKTOP_PREFERENCES,
        remoteEngine: { enabled: true, host: 'user@host', port: 22025 },
      });
      return (
        <SettingsDialog
          {...remoteProps}
          onApplyRemoteEngine={onApplyRemoteEngine}
          onPreferencesChange={setPreferences}
          preferences={preferences}
          remoteStatus={{ state: 'connected', host: 'user@host', port: 22025 }}
        />
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('SSH target'), {
      target: { value: 'other@machine' },
    });
    fireEvent.change(screen.getByLabelText('Forwarded port'), {
      target: { value: '22100' },
    });
    expect(screen.getByLabelText('Forwarded port')).toHaveValue(22100);
    await user.click(screen.getByRole('button', { name: /Reconnect/ }));
    expect(onApplyRemoteEngine).toHaveBeenCalledWith({
      enabled: true,
      host: 'other@machine',
      port: 22100,
    });
  });

  it('surfaces the tunnel status, including errors', () => {
    const { rerender } = render(
      <SettingsDialog
        {...remoteProps}
        onApplyRemoteEngine={vi.fn()}
        onPreferencesChange={vi.fn()}
        preferences={DEFAULT_DESKTOP_PREFERENCES}
        remoteStatus={{ state: 'connected', host: 'user@host', port: 22025 }}
      />,
    );
    expect(screen.getByText(/Connected to user@host/)).toBeInTheDocument();
    rerender(
      <SettingsDialog
        {...remoteProps}
        onApplyRemoteEngine={vi.fn()}
        onPreferencesChange={vi.fn()}
        preferences={DEFAULT_DESKTOP_PREFERENCES}
        remoteStatus={{
          state: 'error',
          host: 'user@host',
          port: 22025,
          message: 'No Herdr server is running on the target machine.',
        }}
      />,
    );
    expect(
      screen.getByText('No Herdr server is running on the target machine.'),
    ).toBeInTheDocument();
  });
});

describe('SettingsDialog remote engine applying state', () => {
  it('keeps controls disabled until the apply promise settles', async () => {
    const user = userEvent.setup();
    let resolveApply!: (status: { state: 'connected'; host: string; port: number }) => void;
    const pending = new Promise<{ state: 'connected'; host: string; port: number }>((resolve) => {
      resolveApply = resolve;
    });
    function Harness() {
      const [preferences, setPreferences] = useState(DEFAULT_DESKTOP_PREFERENCES);
      return (
        <SettingsDialog
          binary="/usr/local/bin/herdr"
          busy={false}
          integrations={[]}
          manifestStatus="ready"
          manifests={[]}
          onApplyRemoteEngine={() => pending}
          onChooseBinary={vi.fn()}
          onInstallIntegration={vi.fn()}
          onOpenChange={vi.fn()}
          onPreferencesChange={setPreferences}
          onReloadConfig={vi.fn()}
          onReloadManifests={vi.fn()}
          onResetBinary={vi.fn()}
          onUninstallIntegration={vi.fn()}
          open
          preferences={preferences}
          remoteStatus={{ state: 'off', host: '', port: 22025 }}
        />
      );
    }
    render(<Harness />);
    const toggle = screen.getByRole('switch', { name: 'Use a remote Herdr engine' });
    await user.click(toggle);
    expect(toggle).toBeDisabled();
    resolveApply({ state: 'connected', host: '', port: 22025 });
    await vi.waitFor(() => expect(toggle).not.toBeDisabled());
  });
});
