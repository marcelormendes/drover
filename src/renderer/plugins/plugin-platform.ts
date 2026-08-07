import type { PluginActionInfo, PluginPlatform } from '@/shared/desktop-api';

export function pluginPlatformFromNavigator(
  platform: string,
  userAgent = '',
): PluginPlatform | undefined {
  const normalized = `${platform} ${userAgent}`.toLocaleLowerCase();
  if (normalized.includes('mac')) return 'macos';
  if (normalized.includes('win')) return 'windows';
  if (normalized.includes('linux')) return 'linux';
  return undefined;
}

export function isPluginActionCompatible(
  action: Pick<PluginActionInfo, 'platforms'>,
  platform: PluginPlatform | undefined,
): boolean {
  return !platform || !action.platforms?.length || action.platforms.includes(platform);
}
