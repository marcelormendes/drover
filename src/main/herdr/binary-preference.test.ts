import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { HerdrBinaryPreference } from '@/main/herdr/binary-preference';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function preference(): Promise<{ store: HerdrBinaryPreference; file: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'herdr-desktop-settings-'));
  cleanup.push(directory);
  const file = path.join(directory, 'settings.json');
  return { store: new HerdrBinaryPreference(file), file };
}

describe('HerdrBinaryPreference', () => {
  it('persists an explicit engine path atomically', async () => {
    const { store } = await preference();

    await expect(store.read()).resolves.toBeNull();
    await store.write('/opt/homebrew/bin/herdr');

    await expect(store.read()).resolves.toBe('/opt/homebrew/bin/herdr');
  });

  it('ignores malformed preference files instead of breaking startup', async () => {
    const { store, file } = await preference();
    await writeFile(file, '{broken', 'utf8');

    await expect(store.read()).resolves.toBeNull();
  });

  it('can return to PATH-based engine discovery', async () => {
    const { store } = await preference();
    await store.write('/custom/herdr');

    await store.clear();

    await expect(store.read()).resolves.toBeNull();
  });
});
