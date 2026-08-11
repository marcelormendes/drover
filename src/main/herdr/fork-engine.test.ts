import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  defaultEngineInstallPath,
  installPinnedEngineBinary,
  pinnedEngineAsset,
  sha256Of,
} from '@/main/herdr/fork-engine';

describe('pinnedEngineAsset', () => {
  it('returns the asset for every supported platform', () => {
    expect(pinnedEngineAsset('linux', 'x64')?.url).toContain('herdr-linux-x86_64');
    expect(pinnedEngineAsset('linux', 'arm64')?.url).toContain('herdr-linux-aarch64');
    expect(pinnedEngineAsset('darwin', 'x64')?.url).toContain('herdr-macos-x86_64');
    expect(pinnedEngineAsset('darwin', 'arm64')?.url).toContain('herdr-macos-aarch64');
  });

  it('returns null on unsupported platforms', () => {
    expect(pinnedEngineAsset('win32', 'x64')).toBeNull();
    expect(pinnedEngineAsset('linux', 'ia32')).toBeNull();
  });
});

describe('installPinnedEngineBinary', () => {
  it('refuses an unpublished release without fetching anything', async () => {
    const fetchBinary = vi.fn();
    const asset = { url: 'https://example.invalid/herdr', sha256: '' };
    await expect(
      installPinnedEngineBinary({ asset, installTo: '/tmp/herdr', fetchBinary }),
    ).rejects.toThrow('not published');
    expect(fetchBinary).not.toHaveBeenCalled();
  });

  it('verifies the checksum and installs with an executable mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'herdr-pin-'));
    try {
      const installTo = join(dir, 'herdr');
      const data = Buffer.from('pinned-engine-bytes');
      const asset = { url: 'https://example.invalid/herdr', sha256: sha256Of(data) };

      await installPinnedEngineBinary({ asset, installTo, fetchBinary: async () => data });

      expect(await readFile(installTo)).toEqual(data);
      expect((await stat(installTo)).mode & 0o111).not.toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('creates missing parent directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'herdr-pin-'));
    try {
      const installTo = join(dir, 'nested', 'bin', 'herdr');
      await installPinnedEngineBinary({
        asset: { url: 'https://example.invalid/herdr', sha256: sha256Of(Buffer.from('x')) },
        installTo,
        fetchBinary: async () => Buffer.from('x'),
      });
      expect(await readFile(installTo)).toEqual(Buffer.from('x'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a checksum mismatch without replacing the target', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'herdr-pin-'));
    try {
      const installTo = join(dir, 'herdr');
      await expect(
        installPinnedEngineBinary({
          asset: { url: 'https://example.invalid/herdr', sha256: 'a'.repeat(64) },
          installTo,
          fetchBinary: async () => Buffer.from('wrong-bytes'),
        }),
      ).rejects.toThrow('checksum mismatch');
      await expect(readFile(installTo)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('defaultEngineInstallPath', () => {
  it('mirrors the official installer location', () => {
    expect(defaultEngineInstallPath()).toMatch(/[\\/]\.local[\\/]bin[\\/]herdr$/);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
