import { PlugZap, RefreshCw, Wrench } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { AgentManifestInfo } from '@/shared/desktop-api';
import type { DesktopPreferences } from '@/shared/preferences';
import type { RemoteEngineStatus, RemoteEngineTarget } from '@/shared/remote-engine';

export interface IntegrationSummary {
  id: string;
  label: string;
  status: 'current' | 'outdated' | 'missing' | 'available' | 'unavailable';
  detail?: string;
}

interface SettingsDialogProps {
  open: boolean;
  binary: string;
  busy: boolean;
  preferences: DesktopPreferences;
  integrations: IntegrationSummary[];
  manifestStatus: 'loading' | 'ready' | 'error';
  manifests: AgentManifestInfo[];
  onOpenChange: (open: boolean) => void;
  onPreferencesChange: (preferences: DesktopPreferences) => void;
  onChooseBinary: () => void;
  onResetBinary: () => void;
  onReloadConfig: () => void;
  onReloadManifests: () => void;
  onInstallIntegration: (id: string) => void;
  onUninstallIntegration: (id: string) => void;
  onApplyRemoteEngine: (target: RemoteEngineTarget) => void;
  remoteStatus: RemoteEngineStatus;
}

function SettingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow">
      <h3 className="mb-3 text-sm font-heading">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsDialog({
  open,
  binary,
  busy,
  preferences,
  integrations,
  manifestStatus,
  manifests,
  onOpenChange,
  onPreferencesChange,
  onChooseBinary,
  onResetBinary,
  onReloadConfig,
  onReloadManifests,
  onInstallIntegration,
  onUninstallIntegration,
  onApplyRemoteEngine,
  remoteStatus,
}: SettingsDialogProps) {
  const update = <Key extends keyof DesktopPreferences>(key: Key, value: DesktopPreferences[Key]) =>
    onPreferencesChange({ ...preferences, [key]: value });
  const [applying, setApplying] = useState(false);
  const apply = (target: RemoteEngineTarget) => {
    setApplying(true);
    void Promise.resolve(onApplyRemoteEngine(target)).finally(() => setApplying(false));
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Presentation preferences stay local; runtime and integration changes go to Herdr.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="grid gap-4 py-1 sm:grid-cols-2">
            <SettingSection title="Appearance">
              <Label className="sr-only" htmlFor="appearance-select">
                Appearance
              </Label>
              <Select
                onValueChange={(value) =>
                  update('appearance', value as DesktopPreferences['appearance'])
                }
                value={preferences.appearance}
              >
                <SelectTrigger aria-label="Appearance" id="appearance-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">Follow system</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </SettingSection>

            <SettingSection title="Status indicators">
              <Label className="sr-only" htmlFor="indicator-select">
                Status indicator style
              </Label>
              <Select
                onValueChange={(value) =>
                  update('indicatorStyle', value as DesktopPreferences['indicatorStyle'])
                }
                value={preferences.indicatorStyle}
              >
                <SelectTrigger aria-label="Status indicator style" id="indicator-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dot">Color dots</SelectItem>
                  <SelectItem value="symbol">Accessible symbols</SelectItem>
                </SelectContent>
              </Select>
            </SettingSection>

            <SettingSection title="Sound">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="sound-switch">Play notification sounds</Label>
                <Switch
                  aria-label="Play notification sounds"
                  checked={preferences.sound}
                  id="sound-switch"
                  onCheckedChange={(checked) => update('sound', checked)}
                />
              </div>
            </SettingSection>

            <SettingSection title="Notifications">
              <Label className="sr-only" htmlFor="notification-select">
                Notification delivery
              </Label>
              <Select
                onValueChange={(value) =>
                  update(
                    'notificationDelivery',
                    value as DesktopPreferences['notificationDelivery'],
                  )
                }
                value={preferences.notificationDelivery}
              >
                <SelectTrigger aria-label="Notification delivery" id="notification-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="in-app">Inside Herdr Desktop</SelectItem>
                  <SelectItem value="system">System notifications</SelectItem>
                </SelectContent>
              </Select>
            </SettingSection>

            <SettingSection title="Pane labels">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="pane-labels-switch">Show agent pane labels</Label>
                <Switch
                  aria-label="Show agent pane labels"
                  checked={preferences.paneLabels}
                  id="pane-labels-switch"
                  onCheckedChange={(checked) => update('paneLabels', checked)}
                />
              </div>
            </SettingSection>

            <SettingSection title="Agent ordering">
              <Label className="sr-only" htmlFor="agent-order-select">
                Agent ordering
              </Label>
              <Select
                onValueChange={(value) =>
                  update('agentSort', value as DesktopPreferences['agentSort'])
                }
                value={preferences.agentSort}
              >
                <SelectTrigger aria-label="Agent ordering" id="agent-order-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="spaces">Group by spaces</SelectItem>
                  <SelectItem value="priority">Attention priority</SelectItem>
                </SelectContent>
              </Select>
            </SettingSection>

            <div className="sm:col-span-2">
              <SettingSection title="Integrations">
                <div className="grid gap-3 sm:grid-cols-2">
                  {integrations.length ? (
                    integrations.map((integration) => (
                      <div
                        className="rounded-base border-2 border-border bg-background p-3"
                        key={integration.id}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-heading">{integration.label}</span>
                          <Badge className="ml-auto" variant="neutral">
                            {integration.status}
                          </Badge>
                        </div>
                        {integration.detail ? (
                          <p className="mt-2 text-xs opacity-70">{integration.detail}</p>
                        ) : null}
                        <div className="mt-3 flex gap-2">
                          {integration.status !== 'current' ? (
                            <Button
                              aria-label={`Install ${integration.label} integration`}
                              disabled={busy || integration.status === 'unavailable'}
                              onClick={() => onInstallIntegration(integration.id)}
                              size="sm"
                            >
                              {integration.status === 'outdated' ? 'Update' : 'Install'}
                            </Button>
                          ) : null}
                          {integration.status === 'current' || integration.status === 'outdated' ? (
                            <Button
                              aria-label={`Uninstall ${integration.label} integration`}
                              disabled={busy}
                              onClick={() => onUninstallIntegration(integration.id)}
                              size="sm"
                              variant="neutral"
                            >
                              Uninstall
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm opacity-70">No integration status is available.</p>
                  )}
                </div>
              </SettingSection>
            </div>

            <div className="sm:col-span-2">
              <SettingSection title="Agent manifests">
                <div className="mb-3 flex justify-end">
                  <Button
                    aria-label="Reload agent manifests"
                    disabled={busy || manifestStatus === 'loading'}
                    onClick={onReloadManifests}
                    size="sm"
                    variant="neutral"
                  >
                    <RefreshCw aria-hidden="true" /> Reload manifests
                  </Button>
                </div>
                {manifestStatus === 'loading' ? (
                  <p className="text-sm" role="status">
                    Reading Herdr agent manifests…
                  </p>
                ) : manifestStatus === 'error' ? (
                  <p className="text-sm" role="alert">
                    Agent manifest diagnostics are unavailable.
                  </p>
                ) : manifests.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {manifests.map((manifest) => (
                      <article
                        className="rounded-base border-2 border-border bg-background p-3"
                        key={`${manifest.agent}:${manifest.source}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-heading">{manifest.agent}</span>
                          <Badge className="ml-auto" variant="neutral">
                            {manifest.active_version
                              ? `v${manifest.active_version}`
                              : 'unversioned'}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs opacity-70">
                          {manifest.source_kind} · {manifest.source}
                        </p>
                        {manifest.warning ? (
                          <p className="mt-2 text-xs" role="alert">
                            {manifest.warning}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm opacity-70">Herdr reported no agent manifests.</p>
                )}
              </SettingSection>
            </div>

            <div className="sm:col-span-2">
              <SettingSection title="Herdr engine">
                <div className="break-all rounded-base border-2 border-border bg-background p-3 font-mono text-xs">
                  {binary}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={onChooseBinary} variant="neutral">
                    <Wrench aria-hidden="true" /> Choose Herdr binary
                  </Button>
                  <Button disabled={busy} onClick={onResetBinary} variant="neutral">
                    Use Herdr from PATH
                  </Button>
                  <Button
                    aria-label="Reload Herdr configuration"
                    disabled={busy}
                    onClick={onReloadConfig}
                  >
                    <RefreshCw aria-hidden="true" /> Reload configuration
                  </Button>
                </div>
              </SettingSection>
            </div>

            <div className="sm:col-span-2">
              <SettingSection title="Remote engine">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="remote-engine-switch">
                    Use a Herdr engine on another computer (SSH)
                  </Label>
                  <Switch
                    aria-label="Use a remote Herdr engine"
                    checked={preferences.remoteEngine.enabled}
                    disabled={applying}
                    id="remote-engine-switch"
                    onCheckedChange={(checked) => {
                      update('remoteEngine', {
                        ...preferences.remoteEngine,
                        enabled: checked,
                      });
                      apply({
                        enabled: checked,
                        host: preferences.remoteEngine.host,
                        port: preferences.remoteEngine.port,
                      });
                    }}
                  />
                </div>
                <div className="mt-3 grid gap-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="remote-engine-host">SSH target</Label>
                    <Input
                      id="remote-engine-host"
                      onChange={(event) =>
                        update('remoteEngine', {
                          ...preferences.remoteEngine,
                          host: event.target.value,
                        })
                      }
                      placeholder="user@host"
                      value={preferences.remoteEngine.host}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="remote-engine-port">Forwarded port</Label>
                    <Input
                      id="remote-engine-port"
                      max={65535}
                      min={1}
                      onChange={(event) => {
                        const port = Number(event.target.value);
                        update('remoteEngine', {
                          ...preferences.remoteEngine,
                          port:
                            Number.isInteger(port) && port >= 1 && port <= 65535
                              ? port
                              : preferences.remoteEngine.port,
                        });
                      }}
                      type="number"
                      value={String(preferences.remoteEngine.port)}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    {preferences.remoteEngine.enabled ? (
                      <Button
                        disabled={busy || applying}
                        onClick={() =>
                          apply({
                            enabled: true,
                            host: preferences.remoteEngine.host,
                            port: preferences.remoteEngine.port,
                          })
                        }
                        variant="neutral"
                      >
                        <PlugZap aria-hidden="true" /> Reconnect
                      </Button>
                    ) : null}
                    <p
                      aria-live="polite"
                      className={
                        remoteStatus.state === 'error'
                          ? 'min-w-0 flex-1 text-xs text-red-500'
                          : 'min-w-0 flex-1 truncate text-xs opacity-70'
                      }
                    >
                      {remoteStatus.state === 'off' && 'Not connected.'}
                      {remoteStatus.state === 'starting' && 'Connecting…'}
                      {remoteStatus.state === 'connected' && `Connected to ${remoteStatus.host}.`}
                      {remoteStatus.state === 'error' &&
                        (remoteStatus.message ?? 'Remote engine connection failed.')}
                    </p>
                  </div>
                  <p className="text-xs leading-relaxed opacity-70">
                    Runs agents, terminals, and files on the remote computer through an SSH tunnel.
                    The target needs a running Herdr server and a socket bridge (
                    <code className="font-mono">
                      socat TCP-LISTEN:&lt;port&gt;,bind=127.0.0.1,reuseaddr,fork
                      UNIX-CONNECT:$HOME/.config/herdr/herdr.sock
                    </code>
                    ). Both sides must run the same Herdr version.
                  </p>
                </div>
              </SettingSection>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
