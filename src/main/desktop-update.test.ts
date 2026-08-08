import { describe, expect, it, vi } from 'vitest';

import {
  checkDesktopUpdate,
  DESKTOP_RELEASE_PAGE_URL,
  isNewerVersion,
} from '@/main/desktop-update';

describe('isNewerVersion', () => {
  it('compares major.minor.patch numerically', () => {
    expect(isNewerVersion('0.1.8', '0.1.7')).toBe(true);
    expect(isNewerVersion('0.1.7', '0.1.8')).toBe(false);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.1.7', '0.1.7')).toBe(false);
  });

  it('tolerates a leading v but never partial or prerelease tags', () => {
    expect(isNewerVersion('v0.2.0', '0.1.9')).toBe(true);
    expect(isNewerVersion('0.2', '0.1.9')).toBe(false);
    expect(isNewerVersion('0.1', '0.1.7')).toBe(false);
    expect(isNewerVersion('foo.1.0', '0.9.0')).toBe(false);
    expect(isNewerVersion('1.0.0-beta.1', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', 'v1.0.0')).toBe(false);
  });
});

describe('checkDesktopUpdate', () => {
  it('reports an update when the latest release is newer', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ tag_name: 'v0.1.8' }), { status: 200 });
    });

    const result = await checkDesktopUpdate('0.1.7', fetcher as typeof fetch);

    expect(result).toEqual({
      currentVersion: '0.1.7',
      latestVersion: '0.1.8',
      updateAvailable: true,
      releaseUrl: DESKTOP_RELEASE_PAGE_URL,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reports up to date when the current build matches the latest release', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ tag_name: '0.1.7' }), { status: 200 });
    });

    const result = await checkDesktopUpdate('0.1.7', fetcher as typeof fetch);

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBe('0.1.7');
  });

  it('reports a failed check without throwing', async () => {
    const fetcher = vi.fn(async () => {
      return new Response('rate limited', { status: 403 });
    });

    const result = await checkDesktopUpdate('0.1.7', fetcher as typeof fetch);

    expect(result).toEqual({
      currentVersion: '0.1.7',
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: DESKTOP_RELEASE_PAGE_URL,
    });
  });

  it('treats a malformed release tag as a failed check', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ tag_name: '1.0.0-beta.1' }), { status: 200 });
    });

    const result = await checkDesktopUpdate('1.0.0', fetcher as typeof fetch);

    expect(result.latestVersion).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });

  it('reports a failed check when the network request rejects', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline');
    });

    const result = await checkDesktopUpdate('0.1.7', fetcher as typeof fetch);

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBeNull();
  });
});
