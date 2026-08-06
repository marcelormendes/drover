export type DesktopAppearance = 'system' | 'light' | 'dark';
export type IndicatorStyle = 'dot' | 'symbol';
export type NotificationDelivery = 'off' | 'in-app' | 'system';
export type AgentSort = 'spaces' | 'priority';

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
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

export function parseDesktopPreferences(value: unknown): DesktopPreferences | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== preferenceKeys.length ||
    !preferenceKeys.every((key) => key in value) ||
    value.schemaVersion !== 1 ||
    !isOneOf(value.appearance, ['system', 'light', 'dark']) ||
    !isOneOf(value.indicatorStyle, ['dot', 'symbol']) ||
    typeof value.sound !== 'boolean' ||
    !isOneOf(value.notificationDelivery, ['off', 'in-app', 'system']) ||
    typeof value.paneLabels !== 'boolean' ||
    !isOneOf(value.agentSort, ['spaces', 'priority']) ||
    typeof value.spacesCollapsed !== 'boolean' ||
    typeof value.agentsCollapsed !== 'boolean'
  ) {
    return null;
  }

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
  };
}
