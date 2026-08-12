import type { DesktopUpdateInfo } from '@/shared/desktop-api';

/** Release page users are sent to when a newer desktop build exists. */
export const DESKTOP_RELEASE_PAGE_URL = 'https://github.com/marcelormendes/drover/releases/latest';

const DESKTOP_RELEASES_API_URL =
  'https://api.github.com/repos/marcelormendes/drover/releases/latest';

const UPDATE_CHECK_TIMEOUT_MS = 10_000;

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export type VersionFetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Strict major.minor.patch parse; returns null for any non-semver input. */
export function parseVersion(value: string): [number, number, number] | null {
  const match = SEMVER_PATTERN.exec(value.trim().replace(/^v/, ''));
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `candidate` is a newer semver than `current`; false for malformed input. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const previous = parseVersion(current);
  if (next === null || previous === null) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== previous[index]) {
      return next[index] > previous[index];
    }
  }
  return false;
}

/**
 * Checks the GitHub releases feed for the newest published Drover.
 * Never throws: a failed check reports `latestVersion: null` so the renderer
 * can surface "could not check" without breaking the rest of the UI.
 */
export async function checkDesktopUpdate(
  currentVersion: string,
  fetcher: VersionFetcher = fetch,
): Promise<DesktopUpdateInfo> {
  const unavailable = (): DesktopUpdateInfo => ({
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: DESKTOP_RELEASE_PAGE_URL,
  });

  try {
    const response = await fetcher(DESKTOP_RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    });
    if (!response.ok) {
      return unavailable();
    }

    const release = (await response.json()) as { tag_name?: unknown };
    const tag =
      typeof release.tag_name === 'string' && release.tag_name.trim() !== ''
        ? release.tag_name.trim()
        : null;
    // Malformed release tags (pre-releases, accidental junk) must not fail
    // open into a false "update available" dialog; treat them as unavailable.
    const latestVersion = tag !== null && parseVersion(tag) !== null ? tag.replace(/^v/, '') : null;
    if (latestVersion === null) {
      return unavailable();
    }
    if (parseVersion(currentVersion) === null) {
      return unavailable();
    }

    return {
      currentVersion,
      latestVersion,
      updateAvailable: isNewerVersion(latestVersion, currentVersion),
      releaseUrl: DESKTOP_RELEASE_PAGE_URL,
    };
  } catch {
    return unavailable();
  }
}
