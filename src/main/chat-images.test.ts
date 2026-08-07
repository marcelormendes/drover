import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { stageChatImages } from '@/main/chat-images';
import { MAX_CHAT_IMAGE_ATTACHMENTS, MAX_CHAT_IMAGE_TOTAL_BYTES } from '@/shared/desktop-api';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('chat image staging', () => {
  const dirs: string[] = [];
  function tempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'herdr-chat-images-test-'));
    dirs.push(dir);
    return dir;
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes each staged image and returns its absolute path', () => {
    const dir = tempDir();
    const paths = stageChatImages(dir, [{ extension: 'png', data: PNG }]);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`));
    expect(paths[0]).toMatch(/herdr-desktop-chat-.*\.png$/);
    expect(readFileSync(paths[0])).toEqual(Buffer.from(PNG, 'base64'));
  });

  it('stages jpg, gif, webp, and bmp payloads with their own extensions', () => {
    const dir = tempDir();
    const paths = stageChatImages(dir, [
      { extension: 'jpg', data: PNG },
      { extension: 'gif', data: PNG },
      { extension: 'webp', data: PNG },
      { extension: 'bmp', data: PNG },
    ]);
    expect(paths.map((path) => path.split('.').pop())).toEqual(['jpg', 'gif', 'webp', 'bmp']);
  });

  it('rejects unsupported image extensions', () => {
    expect(() => stageChatImages(tempDir(), [{ extension: 'svg', data: PNG }])).toThrow(
      /unsupported image extension/i,
    );
  });

  it('rejects malformed base64 payloads', () => {
    expect(() => stageChatImages(tempDir(), [{ extension: 'png', data: 'not-base64!' }])).toThrow(
      /base64/i,
    );
  });

  it('rejects empty payloads', () => {
    expect(() => stageChatImages(tempDir(), [{ extension: 'png', data: '' }])).toThrow(/empty/i);
  });

  it('rejects payloads over the 16 MiB clipboard image limit', () => {
    const oversized = Buffer.alloc(16 * 1024 * 1024 + 1, 7).toString('base64');
    expect(() => stageChatImages(tempDir(), [{ extension: 'png', data: oversized }])).toThrow(
      /16 MiB/i,
    );
  });

  it('rejects non-canonical base64 lengths and padding', () => {
    for (const data of ['A', 'A=', 'AA=', 'AAA==', 'aGVsbG8', 'not-base64!']) {
      expect(() => stageChatImages(tempDir(), [{ extension: 'png', data }])).toThrow(/base64/i);
    }
  });

  it('rejects more than the maximum attachment count', () => {
    const drafts = Array.from({ length: MAX_CHAT_IMAGE_ATTACHMENTS + 1 }, () => ({
      extension: 'png',
      data: PNG,
    }));
    expect(() => stageChatImages(tempDir(), drafts)).toThrow(/attachment limit/i);
  });

  it('rejects batches over the total image byte budget', () => {
    const big = Buffer.alloc((MAX_CHAT_IMAGE_TOTAL_BYTES * 3) / 8, 9).toString('base64');
    expect(() =>
      stageChatImages(tempDir(), [
        { extension: 'png', data: big },
        { extension: 'png', data: big },
        { extension: 'png', data: big },
      ]),
    ).toThrow(/total limit/i);
  });

  it('creates the staging directory with user-only permissions', () => {
    const dir = tempDir();
    const staging = join(dir, 'staging');
    stageChatImages(staging, [{ extension: 'png', data: PNG }]);
    if (process.platform !== 'win32') {
      expect(statSync(staging).mode & 0o777).toBe(0o700);
    }
  });

  it('writes staged images with user-only permissions', () => {
    const dir = tempDir();
    const [path] = stageChatImages(dir, [{ extension: 'png', data: PNG }]);
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses a staging path that is a symlink', () => {
    if (process.platform === 'win32') {
      return;
    }
    const dir = tempDir();
    const real = join(dir, 'real');
    mkdirSync(real);
    const link = join(dir, 'link');
    symlinkSync(real, link);
    expect(() => stageChatImages(link, [{ extension: 'png', data: PNG }])).toThrow(
      /not a directory/i,
    );
  });

  it('refuses a staging path that is an existing regular file', () => {
    const dir = tempDir();
    const path = join(dir, 'occupied');
    writeFileSync(path, 'occupied');
    expect(() => stageChatImages(path, [{ extension: 'png', data: PNG }])).toThrow(
      /not a directory/i,
    );
  });

  it('cleans stale regular files but leaves symlinks and directories alone', () => {
    const dir = tempDir();
    const stale = join(dir, 'herdr-desktop-chat-stale.png');
    writeFileSync(stale, Buffer.from(PNG, 'base64'));
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    const subdir = join(dir, 'herdr-desktop-chat-subdir');
    mkdirSync(subdir);
    utimesSync(subdir, old, old);
    let staleLink: string | undefined;
    if (process.platform !== 'win32') {
      staleLink = join(dir, 'herdr-desktop-chat-link.png');
      symlinkSync(stale, staleLink);
      utimesSync(staleLink, old, old);
    }
    stageChatImages(dir, [{ extension: 'png', data: PNG }]);
    expect(existsSync(stale)).toBe(false);
    expect(lstatSync(subdir).isDirectory()).toBe(true);
    if (staleLink) {
      expect(lstatSync(staleLink).isSymbolicLink()).toBe(true);
    }
  });

  it('stages repeated images under unique file names', () => {
    const dir = tempDir();
    const paths = stageChatImages(dir, [
      { extension: 'png', data: PNG },
      { extension: 'png', data: PNG },
    ]);
    expect(new Set(paths).size).toBe(2);
  });

  it('removes stale staged files older than 24 hours when staging again', () => {
    const dir = tempDir();
    const stale = join(dir, 'herdr-desktop-chat-stale.png');
    writeFileSync(stale, Buffer.from(PNG, 'base64'));
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    stageChatImages(dir, [{ extension: 'png', data: PNG }]);
    expect(existsSync(stale)).toBe(false);
  });

  it('keeps recent staged files when staging again', () => {
    const dir = tempDir();
    const recent = join(dir, 'herdr-desktop-chat-recent.png');
    writeFileSync(recent, Buffer.from(PNG, 'base64'));
    stageChatImages(dir, [{ extension: 'png', data: PNG }]);
    expect(existsSync(recent)).toBe(true);
  });
});
