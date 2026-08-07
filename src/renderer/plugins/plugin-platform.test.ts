import { describe, expect, it } from 'vitest';

import {
  isPluginActionCompatible,
  pluginPlatformFromNavigator,
} from '@/renderer/plugins/plugin-platform';

describe('plugin platform compatibility', () => {
  it.each([
    ['MacIntel', 'macos'],
    ['macOS', 'macos'],
    ['Win32', 'windows'],
    ['Windows', 'windows'],
    ['Linux x86_64', 'linux'],
  ] as const)('maps navigator platform %s to %s', (navigatorPlatform, expected) => {
    expect(pluginPlatformFromNavigator(navigatorPlatform)).toBe(expected);
  });

  it('keeps actions without platform restrictions and hides incompatible actions', () => {
    expect(isPluginActionCompatible({}, 'macos')).toBe(true);
    expect(isPluginActionCompatible({ platforms: [] }, 'macos')).toBe(true);
    expect(isPluginActionCompatible({ platforms: ['linux', 'macos'] }, 'macos')).toBe(true);
    expect(isPluginActionCompatible({ platforms: ['windows'] }, 'macos')).toBe(false);
  });

  it('does not hide actions when the host platform cannot be identified', () => {
    expect(pluginPlatformFromNavigator('unknown')).toBeUndefined();
    expect(isPluginActionCompatible({ platforms: ['windows'] }, undefined)).toBe(true);
  });

  it('falls back to the user agent when navigator.platform is empty', () => {
    expect(pluginPlatformFromNavigator('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(
      'macos',
    );
  });
});
