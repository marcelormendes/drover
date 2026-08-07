import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginCenter, type PluginCenterProps } from '@/renderer/plugins/PluginCenter';

const callbacks = {
  onClosePane: vi.fn(),
  onFocusPane: vi.fn(),
  onInstallPlugin: vi.fn(),
  onInvokeAction: vi.fn(),
  onOpenPane: vi.fn(),
  onSetPluginEnabled: vi.fn(),
};

function renderCenter(overrides: Partial<PluginCenterProps> = {}) {
  return render(
    <PluginCenter
      actions={[]}
      panes={[]}
      plugins={[]}
      status="ready"
      {...callbacks}
      {...overrides}
    />,
  );
}

describe('PluginCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a named loading state for the installed plugin inventory', () => {
    renderCenter({ status: 'loading' });

    expect(screen.getByRole('status')).toHaveTextContent('Loading installed plugins');
  });

  it('renders plugin inventory failures without inventing local plugin state', () => {
    renderCenter({ status: 'error', errorMessage: 'plugin manifest is invalid' });

    expect(screen.getByRole('alert')).toHaveTextContent('plugin manifest is invalid');
  });

  it('renders one empty state when nothing is installed, not three empty panels', () => {
    renderCenter();

    expect(
      screen.getByRole('heading', { name: 'No plugins are installed in Herdr.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Herdr owns its trust preview, build/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Plugin actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Managed plugin panes' })).not.toBeInTheDocument();
  });

  it('starts Herdr’s native install flow for a GitHub plugin source and optional ref', async () => {
    const user = userEvent.setup();
    renderCenter();

    await user.type(
      screen.getByRole('textbox', { name: 'GitHub plugin source' }),
      'smarzban/herdr-file-viewer',
    );
    await user.type(screen.getByRole('textbox', { name: 'Git ref' }), 'v1.15.0');
    await user.click(screen.getByRole('button', { name: 'Install with Herdr' }));

    expect(callbacks.onInstallPlugin).toHaveBeenCalledWith({
      type: 'install-plugin',
      source: 'smarzban/herdr-file-viewer',
      ref: 'v1.15.0',
    });
    expect(screen.getByText(/normal trust preview/i)).toBeInTheDocument();
  });

  it('rejects sources that are not Herdr GitHub shorthands', async () => {
    const user = userEvent.setup();
    renderCenter();

    await user.type(
      screen.getByRole('textbox', { name: 'GitHub plugin source' }),
      'https://github.com/smarzban/herdr-file-viewer',
    );
    await user.click(screen.getByRole('button', { name: 'Install with Herdr' }));

    expect(callbacks.onInstallPlugin).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Use owner/repo');
  });

  it('shows the installed-plugin panel whenever the engine reports plugin data', () => {
    renderCenter({
      panes: [
        {
          paneId: 'w1:p9',
          pluginId: 'example.review',
          title: 'Review dashboard',
          placement: 'overlay',
          focused: false,
        },
      ],
    });

    expect(screen.getByRole('heading', { name: 'Installed plugins' })).toBeInTheDocument();
    expect(screen.getByText('No plugins are installed in Herdr.')).toBeInTheDocument();
  });

  it('does not show a managed-pane panel when Herdr supplies no pane inventory', () => {
    renderCenter({
      plugins: [{ id: 'example.review', name: 'Review', state: 'enabled', version: '1.0.0' }],
    });

    expect(screen.queryByRole('heading', { name: 'Managed plugin panes' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Installed plugins' }).closest('[data-slot="card"]'),
    ).toHaveClass('self-start');
  });

  it('renders installed plugin states and emits enablement intents', async () => {
    const user = userEvent.setup();
    renderCenter({
      plugins: [
        { id: 'example.review', name: 'Review', state: 'enabled', version: '1.0.0' },
        { id: 'example.notes', name: 'Notes', state: 'disabled', version: '2.0.0' },
        {
          error: 'Plugin process exited unexpectedly',
          id: 'example.broken',
          name: 'Broken plugin',
          state: 'error',
          version: '0.1.0',
        },
      ],
    });

    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Plugin process exited unexpectedly')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Disable Review' }));
    expect(callbacks.onSetPluginEnabled).toHaveBeenCalledWith({
      enabled: false,
      pluginId: 'example.review',
      type: 'set-plugin-enabled',
    });

    await user.click(screen.getByRole('switch', { name: 'Enable Notes' }));
    expect(callbacks.onSetPluginEnabled).toHaveBeenCalledWith({
      enabled: true,
      pluginId: 'example.notes',
      type: 'set-plugin-enabled',
    });
    expect(screen.getByRole('switch', { name: 'Broken plugin cannot be enabled' })).toBeDisabled();
  });

  it('searches public actions and emits an invocation intent', async () => {
    const user = userEvent.setup();
    renderCenter({
      actions: [
        { id: 'review', pluginId: 'example.review', title: 'Review changes' },
        { id: 'dashboard', pluginId: 'example.review', title: 'Open dashboard' },
      ],
    });

    await user.type(screen.getByRole('searchbox', { name: 'Search plugin actions' }), 'dashboard');

    expect(screen.queryByText('Review changes')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run Open dashboard' }));
    expect(callbacks.onInvokeAction).toHaveBeenCalledWith({
      actionId: 'dashboard',
      arguments: {},
      pluginId: 'example.review',
      type: 'invoke-plugin-action',
    });
  });

  it('collects action arguments before emitting an invocation intent', async () => {
    const user = userEvent.setup();
    renderCenter({
      actions: [
        {
          arguments: [
            { id: 'branch', kind: 'text', label: 'Branch', required: true },
            { defaultValue: '10', id: 'limit', kind: 'number', label: 'Limit' },
            { id: 'includeUntracked', kind: 'boolean', label: 'Include untracked' },
            {
              defaultValue: 'summary',
              id: 'format',
              kind: 'select',
              label: 'Format',
              options: [
                { label: 'Summary', value: 'summary' },
                { label: 'Full', value: 'full' },
              ],
            },
          ],
          id: 'review',
          pluginId: 'example.review',
          title: 'Review changes',
        },
      ],
    });

    await user.type(screen.getByRole('textbox', { name: 'Branch' }), 'feature/ui');
    await user.clear(screen.getByRole('spinbutton', { name: 'Limit' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Limit' }), '25');
    await user.click(screen.getByRole('switch', { name: 'Include untracked' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Format' }), 'full');
    await user.click(screen.getByRole('button', { name: 'Run Review changes' }));

    expect(callbacks.onInvokeAction).toHaveBeenCalledWith({
      actionId: 'review',
      arguments: { branch: 'feature/ui', format: 'full', includeUntracked: true, limit: '25' },
      pluginId: 'example.review',
      type: 'invoke-plugin-action',
    });
  });

  it('opens plugin panes in every supported placement', async () => {
    const user = userEvent.setup();
    renderCenter({
      plugins: [
        {
          id: 'example.review',
          name: 'Review',
          paneEntrypoints: [
            { id: 'dashboard', title: 'Dashboard' },
            { id: 'history', title: 'History' },
          ],
          state: 'enabled',
          version: '1.0.0',
        },
      ],
    });

    const placement = screen.getByRole('combobox', { name: 'Review pane placement' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(
      expect.arrayContaining(['Overlay', 'Popup', 'Split', 'Tab', 'Zoomed']),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Review pane' }), 'history');
    await user.selectOptions(placement, 'popup');
    const openPane = screen.getByRole('button', { name: 'Open Review pane' });
    expect(openPane).toHaveTextContent('Open pane');
    await user.click(openPane);

    expect(callbacks.onOpenPane).toHaveBeenCalledWith({
      entrypoint: 'history',
      placement: 'popup',
      pluginId: 'example.review',
      type: 'open-plugin-pane',
    });
  });

  it('focuses and closes managed panes with finite intents', async () => {
    const user = userEvent.setup();
    renderCenter({
      panes: [
        {
          focused: false,
          paneId: 'pane-1',
          placement: 'split',
          pluginId: 'example.review',
          title: 'Review dashboard',
        },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Focus Review dashboard' }));
    expect(callbacks.onFocusPane).toHaveBeenCalledWith({
      paneId: 'pane-1',
      type: 'focus-plugin-pane',
    });
    await user.click(screen.getByRole('button', { name: 'Close Review dashboard' }));
    expect(callbacks.onClosePane).toHaveBeenCalledWith({
      paneId: 'pane-1',
      type: 'close-plugin-pane',
    });
  });
});
