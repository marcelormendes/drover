import { MAX_REMOTE_ENGINE_PORT } from '@/shared/remote-engine';

export type DesktopAppearance = 'system' | 'light' | 'dark';
export type IndicatorStyle = 'dot' | 'symbol';
export type NotificationDelivery = 'off' | 'in-app' | 'system';
export type AgentSort = 'spaces' | 'priority';

export interface RemoteEnginePreference {
  enabled: boolean;
  /** SSH target for the tunnel, e.g. `user@host`. */
  host: string;
  /** API TCP port forwarded by `ssh -L`; the client uses the next port. */
  port: number;
}

export const DEFAULT_REMOTE_ENGINE_PREFERENCE: RemoteEnginePreference = Object.freeze({
  enabled: false,
  host: '',
  port: 22025,
});

export interface DesktopPreferences {
  schemaVersion: 1;
  appearance: DesktopAppearance;
  indicatorStyle: IndicatorStyle;
  sound: boolean;
  notificationDelivery: NotificationDelivery;
  paneLabels: boolean;
  agentSort: AgentSort;
  spacesCollapsed: boolean;
  agentsCollapsed: boolean;
  remoteEngine: RemoteEnginePreference;
}

export type DesktopPreferencesInput = Omit<DesktopPreferences, 'schemaVersion'>;

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = Object.freeze({
  schemaVersion: 1,
  appearance: 'system',
  indicatorStyle: 'dot',
  sound: true,
  notificationDelivery: 'in-app',
  paneLabels: true,
  agentSort: 'spaces',
  spacesCollapsed: false,
  agentsCollapsed: false,
  remoteEngine: DEFAULT_REMOTE_ENGINE_PREFERENCE,
});

const preferenceKeys = [
  'schemaVersion',
  'appearance',
  'indicatorStyle',
  'sound',
  'notificationDelivery',
  'paneLabels',
  'agentSort',
  'spacesCollapsed',
  'agentsCollapsed',
  'remoteEngine',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

function isRemoteEnginePreference(value: unknown): value is RemoteEnginePreference {
  return (
    isRecord(value) &&
    typeof value.enabled === 'boolean' &&
    typeof value.host === 'string' &&
    typeof value.port === 'number' &&
    Number.isInteger(value.port) &&
    value.port >= 1 &&
    value.port <= MAX_REMOTE_ENGINE_PORT
  );
}

export function parseDesktopPreferences(value: unknown): DesktopPreferences | null {
  // Files written before the remote engine preference existed lack the key;
  // accept them and fill the default so upgrades do not reset user settings.
  const hasRemoteEngine = isRecord(value) && 'remoteEngine' in value;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== preferenceKeys.length - (hasRemoteEngine ? 0 : 1) ||
    !preferenceKeys.filter((key) => key !== 'remoteEngine').every((key) => key in value) ||
    value.schemaVersion !== 1 ||
    !isOneOf(value.appearance, ['system', 'light', 'dark']) ||
    !isOneOf(value.indicatorStyle, ['dot', 'symbol']) ||
    typeof value.sound !== 'boolean' ||
    !isOneOf(value.notificationDelivery, ['off', 'in-app', 'system']) ||
    typeof value.paneLabels !== 'boolean' ||
    !isOneOf(value.agentSort, ['spaces', 'priority']) ||
    typeof value.spacesCollapsed !== 'boolean' ||
    typeof value.agentsCollapsed !== 'boolean' ||
    (hasRemoteEngine && !isRemoteEnginePreference(value.remoteEngine))
  ) {
    return null;
  }

  const remoteEngine: RemoteEnginePreference =
    hasRemoteEngine && isRemoteEnginePreference(value.remoteEngine)
      ? value.remoteEngine
      : { ...DEFAULT_REMOTE_ENGINE_PREFERENCE };

  return {
    schemaVersion: 1,
    appearance: value.appearance,
    indicatorStyle: value.indicatorStyle,
    sound: value.sound,
    notificationDelivery: value.notificationDelivery,
    paneLabels: value.paneLabels,
    agentSort: value.agentSort,
    spacesCollapsed: value.spacesCollapsed,
    agentsCollapsed: value.agentsCollapsed,
    remoteEngine,
  };
}
