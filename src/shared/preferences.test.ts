import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DESKTOP_PREFERENCES,
  DEFAULT_REMOTE_ENGINE_PREFERENCE,
  parseDesktopPreferences,
} from '@/shared/preferences';

const completePreferences = {
  schemaVersion: 1,
  appearance: 'dark',
  indicatorStyle: 'symbol',
  sound: false,
  notificationDelivery: 'off',
  paneLabels: false,
  agentSort: 'priority',
  spacesCollapsed: true,
  agentsCollapsed: true,
  remoteEngine: {
    enabled: true,
    host: 'user@host',
    port: 22025,
  },
};

describe('parseDesktopPreferences', () => {
  it('parses a complete preferences object with a remote engine', () => {
    const parsed = parseDesktopPreferences(completePreferences);
    expect(parsed).not.toBeNull();
    expect(parsed?.remoteEngine).toEqual({
      enabled: true,
      host: 'user@host',
      port: 22025,
    });
  });

  it('accepts files written before the remote engine existed and fills defaults', () => {
    const { remoteEngine: _remoteEngine, ...legacy } = completePreferences;
    const parsed = parseDesktopPreferences(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed?.remoteEngine).toEqual(DEFAULT_REMOTE_ENGINE_PREFERENCE);
  });

  it('defaults to the remote engine disabled', () => {
    expect(DEFAULT_DESKTOP_PREFERENCES.remoteEngine).toEqual(DEFAULT_REMOTE_ENGINE_PREFERENCE);
    expect(DEFAULT_REMOTE_ENGINE_PREFERENCE.enabled).toBe(false);
    expect(DEFAULT_REMOTE_ENGINE_PREFERENCE.port).toBe(22025);
  });

  it('rejects a malformed remote engine', () => {
    for (const remoteEngine of [
      null,
      'remote',
      { enabled: 'yes', host: 'user@host', port: 22025 },
      { enabled: true, host: 42, port: 22025 },
      { enabled: true, host: 'user@host', port: 0 },
      { enabled: true, host: 'user@host', port: 70000 },
      { enabled: true, host: 'user@host', port: 22.5 },
    ]) {
      expect(parseDesktopPreferences({ ...completePreferences, remoteEngine })).toBeNull();
    }
  });

  it('still rejects files with unknown or missing keys', () => {
    expect(parseDesktopPreferences({ ...completePreferences, mystery: 1 })).toBeNull();
    const { appearance: _appearance, ...withoutAppearance } = completePreferences;
    expect(parseDesktopPreferences(withoutAppearance)).toBeNull();
  });
});
