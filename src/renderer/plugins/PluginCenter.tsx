import { Blocks, Download } from 'lucide-react';
import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

export type PluginCenterStatus = 'loading' | 'ready' | 'error';
export type InstalledPluginState = 'enabled' | 'disabled' | 'error';
export type PluginPanePlacement = 'overlay' | 'popup' | 'split' | 'tab' | 'zoomed';

export interface PluginPaneEntrypoint {
  id: string;
  title: string;
}

export interface InstalledPluginViewModel {
  id: string;
  name: string;
  version: string;
  description?: string;
  state: InstalledPluginState;
  error?: string;
  warnings?: string[];
  paneEntrypoints?: PluginPaneEntrypoint[];
}

export type PluginActionArgument =
  | {
      id: string;
      label: string;
      kind: 'text' | 'number';
      description?: string;
      placeholder?: string;
      required?: boolean;
      defaultValue?: string;
    }
  | {
      id: string;
      label: string;
      kind: 'boolean';
      description?: string;
      defaultValue?: boolean;
    }
  | {
      id: string;
      label: string;
      kind: 'select';
      description?: string;
      required?: boolean;
      defaultValue?: string;
      options: Array<{ label: string; value: string }>;
    };

export interface PluginActionViewModel {
  pluginId: string;
  id: string;
  title: string;
  description?: string;
  contexts?: string[];
  arguments?: PluginActionArgument[];
}

export interface ManagedPluginPaneViewModel {
  paneId: string;
  pluginId: string;
  title: string;
  placement: PluginPanePlacement;
  focused: boolean;
}

export interface SetPluginEnabledIntent {
  type: 'set-plugin-enabled';
  pluginId: string;
  enabled: boolean;
}

export interface InstallPluginIntent {
  type: 'install-plugin';
  source: string;
  ref?: string;
}

export interface InvokePluginActionIntent {
  type: 'invoke-plugin-action';
  pluginId: string;
  actionId: string;
  arguments: Record<string, string | boolean>;
}

export interface OpenPluginPaneIntent {
  type: 'open-plugin-pane';
  pluginId: string;
  entrypoint: string;
  placement: PluginPanePlacement;
}

export interface FocusPluginPaneIntent {
  type: 'focus-plugin-pane';
  paneId: string;
}

export interface ClosePluginPaneIntent {
  type: 'close-plugin-pane';
  paneId: string;
}

export interface PluginCenterProps {
  status: PluginCenterStatus;
  errorMessage?: string;
  plugins: InstalledPluginViewModel[];
  actions: PluginActionViewModel[];
  panes: ManagedPluginPaneViewModel[];
  onInstallPlugin: (intent: InstallPluginIntent) => void;
  onSetPluginEnabled: (intent: SetPluginEnabledIntent) => void;
  onInvokeAction: (intent: InvokePluginActionIntent) => void;
  onOpenPane: (intent: OpenPluginPaneIntent) => void;
  onFocusPane: (intent: FocusPluginPaneIntent) => void;
  onClosePane: (intent: ClosePluginPaneIntent) => void;
}

const placementOptions: Array<{ label: string; value: PluginPanePlacement }> = [
  { label: 'Overlay', value: 'overlay' },
  { label: 'Popup', value: 'popup' },
  { label: 'Split', value: 'split' },
  { label: 'Tab', value: 'tab' },
  { label: 'Zoomed', value: 'zoomed' },
];

const selectClassName =
  'h-10 w-full rounded-base border-2 border-border bg-secondary-background px-3 text-sm font-base focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2';

const githubPluginSourcePattern = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function PluginInstaller({
  onInstallPlugin,
}: {
  onInstallPlugin: PluginCenterProps['onInstallPlugin'];
}) {
  const [source, setSource] = useState('');
  const [ref, setRef] = useState('');
  const [sourceError, setSourceError] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedSource = source.trim();
    if (!githubPluginSourcePattern.test(normalizedSource)) {
      setSourceError('Use owner/repo or owner/repo/subdir, not a GitHub URL.');
      return;
    }
    setSourceError('');
    onInstallPlugin({
      type: 'install-plugin',
      source: normalizedSource,
      ...(ref.trim() ? { ref: ref.trim() } : {}),
    });
  };

  return (
    <Card className="bg-secondary-background">
      <CardHeader>
        <CardTitle>
          <h2>Install from GitHub</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(10rem,0.45fr)_auto]"
          onSubmit={submit}
        >
          <Label className="grid gap-1">
            <span>GitHub plugin source</span>
            <Input
              aria-label="GitHub plugin source"
              aria-describedby={sourceError ? 'plugin-source-error' : undefined}
              aria-invalid={sourceError ? 'true' : undefined}
              onChange={(event) => {
                setSource(event.target.value);
                setSourceError('');
              }}
              placeholder="owner/repo or owner/repo/subdir"
              required
              value={source}
            />
            {sourceError ? (
              <span className="text-xs text-destructive" id="plugin-source-error" role="alert">
                {sourceError}
              </span>
            ) : null}
          </Label>
          <Label className="grid gap-1">
            <span>Git ref</span>
            <Input
              aria-label="Git ref"
              onChange={(event) => setRef(event.target.value)}
              placeholder="Optional branch, tag, or commit"
              value={ref}
            />
          </Label>
          <Button className="self-end" type="submit">
            <Download aria-hidden="true" /> Install with Herdr
          </Button>
        </form>
        <p className="mt-3 text-xs text-foreground/65">
          Opens a Herdr terminal tab with the normal trust preview. Review the manifest commands,
          then approve or cancel there exactly as you would in the Herdr CLI.
        </p>
      </CardContent>
    </Card>
  );
}

function PluginPaneLauncher({
  plugin,
  onOpenPane,
}: {
  plugin: InstalledPluginViewModel;
  onOpenPane: PluginCenterProps['onOpenPane'];
}) {
  const entrypoints = plugin.paneEntrypoints || [];
  const [entrypoint, setEntrypoint] = useState(entrypoints[0]?.id || '');
  const [placement, setPlacement] = useState<PluginPanePlacement>('overlay');
  if (entrypoints.length === 0) return null;

  return (
    <div className="grid gap-2 border-t-2 border-border pt-3 sm:grid-cols-[1fr_1fr_auto]">
      <Label className="grid gap-1">
        <span>{plugin.name} pane</span>
        <select
          aria-label={`${plugin.name} pane`}
          className={selectClassName}
          value={entrypoint}
          onChange={(event) => setEntrypoint(event.target.value)}
        >
          {entrypoints.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </Label>
      <Label className="grid gap-1">
        <span>Placement</span>
        <select
          aria-label={`${plugin.name} pane placement`}
          className={selectClassName}
          value={placement}
          onChange={(event) => setPlacement(event.target.value as PluginPanePlacement)}
        >
          {placementOptions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </Label>
      <Button
        aria-label={`Open ${plugin.name} pane`}
        className="self-end"
        type="button"
        onClick={() =>
          onOpenPane({ type: 'open-plugin-pane', pluginId: plugin.id, entrypoint, placement })
        }
      >
        Open pane
      </Button>
    </div>
  );
}

function initialArguments(action: PluginActionViewModel) {
  return Object.fromEntries(
    (action.arguments || []).map((argument) => {
      if (argument.kind === 'boolean') {
        return [argument.id, argument.defaultValue ?? false];
      }
      if (argument.kind === 'select') {
        return [argument.id, argument.defaultValue ?? argument.options[0]?.value ?? ''];
      }
      return [argument.id, argument.defaultValue ?? ''];
    }),
  ) as Record<string, string | boolean>;
}

function PluginActionCard({
  action,
  onInvokeAction,
}: {
  action: PluginActionViewModel;
  onInvokeAction: PluginCenterProps['onInvokeAction'];
}) {
  const [values, setValues] = useState(() => initialArguments(action));
  const setValue = (id: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [id]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onInvokeAction({
      type: 'invoke-plugin-action',
      pluginId: action.pluginId,
      actionId: action.id,
      arguments: values,
    });
  };

  return (
    <form className="rounded-base border-2 border-border bg-background p-4" onSubmit={submit}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading">{action.title}</h3>
          {action.description ? (
            <p className="text-sm text-foreground/70">{action.description}</p>
          ) : null}
          <p className="text-xs text-foreground/60">{action.pluginId}</p>
        </div>
        <Button size="sm" type="submit" aria-label={`Run ${action.title}`}>
          Run
        </Button>
      </div>
      {(action.arguments || []).length > 0 ? (
        <div className="grid gap-3 border-t-2 border-border pt-3">
          {(action.arguments || []).map((argument) => {
            if (argument.kind === 'boolean') {
              return (
                <Label className="flex items-center justify-between gap-3" key={argument.id}>
                  <span>{argument.label}</span>
                  <Switch
                    aria-label={argument.label}
                    checked={Boolean(values[argument.id])}
                    onCheckedChange={(checked) => setValue(argument.id, checked)}
                  />
                </Label>
              );
            }
            if (argument.kind === 'select') {
              return (
                <Label className="grid gap-1" key={argument.id}>
                  <span>{argument.label}</span>
                  <select
                    aria-label={argument.label}
                    className={selectClassName}
                    required={argument.required}
                    value={String(values[argument.id])}
                    onChange={(event) => setValue(argument.id, event.target.value)}
                  >
                    {argument.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Label>
              );
            }
            return (
              <Label className="grid gap-1" key={argument.id}>
                <span>{argument.label}</span>
                <Input
                  aria-label={argument.label}
                  placeholder={argument.placeholder}
                  required={argument.required}
                  type={argument.kind}
                  value={String(values[argument.id])}
                  onChange={(event) => setValue(argument.id, event.target.value)}
                />
              </Label>
            );
          })}
        </div>
      ) : null}
    </form>
  );
}

export function PluginCenter({
  status,
  errorMessage,
  plugins,
  actions,
  panes,
  onInstallPlugin,
  onSetPluginEnabled,
  onInvokeAction,
  onOpenPane,
  onFocusPane,
  onClosePane,
}: PluginCenterProps) {
  const [actionQuery, setActionQuery] = useState('');
  const visibleActions = useMemo(() => {
    const query = actionQuery.trim().toLocaleLowerCase();
    if (!query) return actions;
    return actions.filter((action) => {
      const pluginName = plugins.find((plugin) => plugin.id === action.pluginId)?.name || '';
      return [action.title, action.description, action.pluginId, pluginName]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [actionQuery, actions, plugins]);
  if (status === 'loading') {
    return (
      <Card className="bg-secondary-background" role="status">
        <CardHeader>
          <CardTitle>Plugin center</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>Loading installed plugins…</p>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (status === 'error') {
    return (
      <Card className="bg-secondary-background" role="alert">
        <CardHeader>
          <CardTitle>Plugins could not be loaded</CardTitle>
        </CardHeader>
        <CardContent>
          {errorMessage || 'Herdr did not return the installed plugin inventory.'}
        </CardContent>
      </Card>
    );
  }
  if (plugins.length === 0 && actions.length === 0 && panes.length === 0) {
    return (
      <div className="@container grid gap-4">
        <PluginInstaller onInstallPlugin={onInstallPlugin} />
        <div className="grid place-items-center rounded-base border-2 border-dashed border-border px-6 py-14 text-center">
          <Blocks aria-hidden="true" className="mb-4 size-8 opacity-40" />
          <h2 className="font-heading text-lg">No plugins are installed in Herdr.</h2>
          <p className="mt-2 max-w-md text-sm opacity-70">
            Install a GitHub plugin above. Herdr owns its trust preview, build, registration,
            actions, and panes.
          </p>
        </div>
      </div>
    );
  }

  return (
    // Container queries, not viewport ones: this lives inside a dialog whose
    // width is unrelated to the window's.
    <div className="@container grid min-h-0 gap-4">
      <PluginInstaller onInstallPlugin={onInstallPlugin} />
      <div className="grid min-h-0 gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <Card className="self-start bg-secondary-background">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <h2>Installed plugins</h2>
              <Badge variant="neutral">{plugins.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {plugins.length === 0 ? (
              <div className="rounded-base border-2 border-dashed border-border p-5 text-sm">
                No plugins are installed in Herdr.
              </div>
            ) : (
              plugins.map((plugin) => {
                const isError = plugin.state === 'error';
                const isEnabled = plugin.state === 'enabled';
                return (
                  <article
                    className="rounded-base border-2 border-border bg-background p-4"
                    key={plugin.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-heading">{plugin.name}</h3>
                          <Badge variant={isEnabled ? 'default' : 'neutral'}>
                            {isError ? 'Error' : isEnabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                          <span className="text-xs text-foreground/60">v{plugin.version}</span>
                        </div>
                        {plugin.description ? (
                          <p className="mt-1 text-sm">{plugin.description}</p>
                        ) : null}
                        {plugin.error ? (
                          <p className="mt-2 text-sm text-red-700">{plugin.error}</p>
                        ) : null}
                        {(plugin.warnings || []).map((warning) => (
                          <p className="mt-2 text-sm" key={warning}>
                            {warning}
                          </p>
                        ))}
                      </div>
                      <Switch
                        aria-label={
                          isError
                            ? `${plugin.name} cannot be enabled`
                            : `${isEnabled ? 'Disable' : 'Enable'} ${plugin.name}`
                        }
                        checked={isEnabled}
                        disabled={isError}
                        onCheckedChange={(enabled) =>
                          onSetPluginEnabled({
                            type: 'set-plugin-enabled',
                            pluginId: plugin.id,
                            enabled,
                          })
                        }
                      />
                    </div>
                    <PluginPaneLauncher plugin={plugin} onOpenPane={onOpenPane} />
                  </article>
                );
              })
            )}
          </CardContent>
        </Card>
        <div className="grid min-h-0 gap-4">
          <Card className="bg-secondary-background">
            <CardHeader>
              <CardTitle>
                <h2>Plugin actions</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                aria-label="Search plugin actions"
                placeholder="Search actions"
                role="searchbox"
                value={actionQuery}
                onChange={(event) => setActionQuery(event.target.value)}
              />
              {actions.length === 0 ? (
                <div className="rounded-base border-2 border-dashed border-border p-4 text-sm">
                  No public plugin actions are available.
                </div>
              ) : visibleActions.length === 0 ? (
                <div className="rounded-base border-2 border-dashed border-border p-4 text-sm">
                  No plugin actions match your search.
                </div>
              ) : (
                visibleActions.map((action) => (
                  <PluginActionCard
                    action={action}
                    key={`${action.pluginId}:${action.id}`}
                    onInvokeAction={onInvokeAction}
                  />
                ))
              )}
            </CardContent>
          </Card>
          {panes.length > 0 ? (
            <Card className="bg-secondary-background">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <h2>Managed plugin panes</h2>
                  <Badge variant="neutral">{panes.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {panes.map((pane) => (
                  <article
                    className="rounded-base border-2 border-border bg-background p-4"
                    key={pane.paneId}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-heading">{pane.title}</h3>
                      <Badge variant="neutral">{pane.placement}</Badge>
                      {pane.focused ? <Badge>Focused</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-foreground/60">{pane.pluginId}</p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        aria-label={`Focus ${pane.title}`}
                        disabled={pane.focused}
                        size="sm"
                        type="button"
                        variant="neutral"
                        onClick={() =>
                          onFocusPane({ type: 'focus-plugin-pane', paneId: pane.paneId })
                        }
                      >
                        Focus
                      </Button>
                      <Button
                        aria-label={`Close ${pane.title}`}
                        size="sm"
                        type="button"
                        onClick={() =>
                          onClosePane({ type: 'close-plugin-pane', paneId: pane.paneId })
                        }
                      >
                        Close
                      </Button>
                    </div>
                  </article>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
