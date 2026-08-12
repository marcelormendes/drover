import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const INSTALLER = path.resolve('scripts/install.sh');
const ASSET_NAME = 'drover-linux-x86_64.AppImage';

interface Fixture {
  root: string;
  home: string;
  dist: string;
}

function makeFixture(tampered = false): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'herdr-installer-'));
  const home = path.join(root, 'home');
  const dist = path.join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  const asset = path.join(dist, ASSET_NAME);
  writeFileSync(asset, 'stub-appimage');
  writeFileSync(path.join(dist, 'icon.png'), 'stub-icon');
  const checksum = `${createHash('sha256').update(readFileSync(asset)).digest('hex')}  ${ASSET_NAME}\n`;
  writeFileSync(path.join(dist, 'checksums.sha256'), checksum);
  if (tampered) {
    writeFileSync(asset, 'tampered-appimage');
  }
  return { root, home, dist };
}

function replaceAsset(fixture: Fixture, content: string): void {
  writeFileSync(path.join(fixture.dist, ASSET_NAME), content);
  writeFileSync(
    path.join(fixture.dist, 'checksums.sha256'),
    `${createHash('sha256').update(content).digest('hex')}  ${ASSET_NAME}\n`,
  );
}

function runInstaller(
  fixture: Fixture,
  args: string[] = [],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    'sh',
    [
      INSTALLER,
      '--base-url',
      `file://${fixture.dist}`,
      '--icon-url',
      `file://${fixture.dist}/icon.png`,
      ...args,
    ],
    { encoding: 'utf8', env: { ...process.env, HOME: fixture.home } },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const binary = (fixture: Fixture) => path.join(fixture.home, '.local', 'bin', 'drover');
const icon = (fixture: Fixture) =>
  path.join(fixture.home, '.local', 'share', 'icons', 'hicolor', '1024x1024', 'apps', 'drover.png');
const desktopEntry = (fixture: Fixture) =>
  path.join(fixture.home, '.local', 'share', 'applications', 'drover.desktop');

const requiresUnixToolchain =
  process.platform === 'win32' ||
  !existsSync('/bin/sh') ||
  !existsSync('/usr/bin/curl') ||
  !existsSync('/usr/bin/sha256sum');

describe.skipIf(requiresUnixToolchain)('Linux installer script', () => {
  it('installs the binary, icon, and desktop entry per-user', () => {
    const fixture = makeFixture();
    try {
      const result = runInstaller(fixture);
      expect(result.status).toBe(0);

      expect(statSync(binary(fixture)).mode & 0o111).not.toBe(0);
      expect(existsSync(icon(fixture))).toBe(true);

      const entry = readFileSync(desktopEntry(fixture), 'utf8');
      expect(entry).toContain(`Exec=${binary(fixture)}`);
      expect(entry).toContain('Icon=drover');
      expect(entry).toContain('Categories=Development;Utility;');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('updates an existing install on re-run', () => {
    const fixture = makeFixture();
    try {
      expect(runInstaller(fixture).status).toBe(0);

      replaceAsset(fixture, 'updated-appimage-content');
      const result = runInstaller(fixture);
      expect(result.status).toBe(0);
      expect(readFileSync(binary(fixture), 'utf8')).toBe('updated-appimage-content');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('aborts on a checksum mismatch and installs nothing', () => {
    const fixture = makeFixture(true);
    try {
      const result = runInstaller(fixture);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('checksum verification failed');
      expect(existsSync(binary(fixture))).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('aborts when no checksum entry exists for the asset', () => {
    const fixture = makeFixture();
    try {
      writeFileSync(path.join(fixture.dist, 'checksums.sha256'), 'deadbeef  wrong-name.AppImage\n');
      const result = runInstaller(fixture);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('no checksum entry');
      expect(existsSync(binary(fixture))).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('uninstalls exactly the files it wrote', () => {
    const fixture = makeFixture();
    try {
      expect(runInstaller(fixture).status).toBe(0);
      const sentinel = path.join(fixture.home, '.local', 'share', 'herdr-sentinel');
      writeFileSync(sentinel, 'keep me');
      const result = runInstaller(fixture, ['--uninstall']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('removed');
      expect(existsSync(binary(fixture))).toBe(false);
      expect(existsSync(icon(fixture))).toBe(false);
      expect(existsSync(desktopEntry(fixture))).toBe(false);
      expect(existsSync(sentinel)).toBe(true);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects unknown flags and prints help', () => {
    const fixture = makeFixture();
    try {
      const bogus = runInstaller(fixture, ['--bogus']);
      expect(bogus.status).not.toBe(0);

      const help = runInstaller(fixture, ['--help']);
      expect(help.status).toBe(0);
      expect(help.stdout).toContain('Drover Linux installer');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
