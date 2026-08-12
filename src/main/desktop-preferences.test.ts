import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_DESKTOP_PREFERENCES, DesktopPreferencesStore } from '@/main/desktop-preferences';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function store(): Promise<{ preferences: DesktopPreferencesStore; file: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'drover-preferences-'));
  cleanup.push(directory);
  const file = path.join(directory, 'desktop-preferences.json');
  return { preferences: new DesktopPreferencesStore(file), file };
}

describe('DesktopPreferencesStore', () => {
  it('returns safe defaults and persists presentation-only settings with user permissions', async () => {
    const { preferences, file } = await store();

    await expect(preferences.read()).resolves.toEqual(DEFAULT_DESKTOP_PREFERENCES);
    const saved = await preferences.write({
      appearance: 'dark',
      indicatorStyle: 'symbol',
      sound: false,
      notificationDelivery: 'system',
      paneLabels: false,
      agentSort: 'priority',
      spacesCollapsed: true,
      agentsCollapsed: false,
      remoteEngine: { enabled: false, host: '', port: 22025 },
    });

    expect(saved).toMatchObject({ appearance: 'dark', agentSort: 'priority' });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(saved);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('recovers from malformed and invalid values without accepting alternate session state', async () => {
    const { preferences, file } = await store();
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        appearance: 'ultraviolet',
        indicatorStyle: 'dot',
        sound: true,
        notificationDelivery: 'in-app',
        paneLabels: true,
        agentSort: 'spaces',
        spacesCollapsed: false,
        agentsCollapsed: false,
        workspaces: [{ id: 'desktop-owned-state-must-not-load' }],
      }),
      'utf8',
    );

    await expect(preferences.read()).resolves.toEqual(DEFAULT_DESKTOP_PREFERENCES);
  });
});
