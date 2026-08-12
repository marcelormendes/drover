import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PKGBUILD = path.join(ROOT, 'packaging', 'aur', 'PKGBUILD');
const SRCINFO = path.join(ROOT, 'packaging', 'aur', '.SRCINFO');
const FLATHUB_MANIFEST = path.join(
  ROOT,
  'packaging',
  'flathub',
  'io.github.marcelormendes.drover.yml',
);
const FLATHUB_JSON = path.join(ROOT, 'packaging', 'flathub', 'flathub.json');

const packageVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

describe('AUR packaging contract', () => {
  it('uses the -bin name, trails no future package version, and pins every source', () => {
    const pkgbuild = readFileSync(PKGBUILD, 'utf8');
    const aurVersion = pkgbuild.match(/^pkgver=(\d+\.\d+\.\d+)$/m)?.[1];

    // Prebuilt upstream artifact while source is available -> -bin suffix,
    // providing/conflicting with the source package name.
    expect(pkgbuild).toMatch(/^pkgname=drover-bin$/m);
    expect(pkgbuild).toContain("provides=('drover')");
    expect(pkgbuild).toContain("conflicts=('drover')");
    expect(aurVersion).toBeDefined();
    expect(
      aurVersion?.localeCompare(packageVersion, undefined, { numeric: true, sensitivity: 'base' }),
    ).not.toBeGreaterThan(0);
    expect(pkgbuild).toContain("arch=('x86_64')");
    expect(pkgbuild).toContain("depends=('fuse2')");
    // The AppImage is a self-contained ELF; stripping destroys it.
    expect(pkgbuild).toContain("options=('!strip' '!debug')");
    expect(pkgbuild).toContain(
      'drover-linux-x86_64.AppImage::https://github.com/marcelormendes/drover/releases/download/',
    );

    // Every source (AppImage, icon, LICENSE) must be pinned, none skipped.
    const sha256sums = pkgbuild.match(/sha256sums=\(([^)]*)\)/)?.[1] ?? '';
    const pinned = sha256sums.match(/'([0-9a-f]{64})'/g) ?? [];
    expect(pinned).toHaveLength(3);
    expect(sha256sums).not.toContain('SKIP');
  });

  it('keeps .SRCINFO in sync with the PKGBUILD', () => {
    const pkgbuild = readFileSync(PKGBUILD, 'utf8');
    const srcinfo = readFileSync(SRCINFO, 'utf8');
    const lines = srcinfo.split('\n').map((line) => line.trim());
    const aurVersion = pkgbuild.match(/^pkgver=(\d+\.\d+\.\d+)$/m)?.[1];

    expect(aurVersion).toBeDefined();
    expect(lines).toContain('pkgbase = drover-bin');
    expect(lines).toContain(`pkgver = ${aurVersion}`);
    expect(lines).toContain('pkgname = drover-bin');
  });
});

describe('Flathub submission contract', () => {
  it('pins the application identity, runtime, and trust boundary', () => {
    const manifest = readFileSync(FLATHUB_MANIFEST, 'utf8');

    expect(manifest).toContain('app-id: io.github.marcelormendes.drover');
    expect(manifest).toContain("runtime-version: '25.08'");
    expect(manifest).toContain('base: org.electronjs.Electron2.BaseApp');
    expect(manifest).toContain('--talk-name=org.freedesktop.Flatpak');
    expect(manifest).toContain('--filesystem=xdg-config/herdr:create');
    expect(manifest).toContain('--filesystem=xdg-data/drover:create');
    expect(manifest).toContain('patch-electron-desktop-filename');
    expect(manifest).toContain('__VERSION__');
  });

  it('keeps the archive version and git tag consistent', () => {
    const manifest = readFileSync(FLATHUB_MANIFEST, 'utf8');

    const archiveUrl = manifest.match(
      /url: (https:\/\/github\.com\/marcelormendes\/drover\/releases\/download\/(v\d+\.\d+\.\d+)\/drover-linux-x64\.zip)/,
    );
    const gitTag = manifest.match(/tag: (v\d+\.\d+\.\d+)/);

    expect(archiveUrl?.[2]).toBeDefined();
    expect(gitTag?.[1]).toBe(archiveUrl?.[2]);
  });

  it('documents the blocked submission status and exception requirements', () => {
    const readme = readFileSync(path.join(ROOT, 'packaging', 'flathub', 'README.md'), 'utf8');

    expect(readme).toContain('BLOCKED — requires an explicit Flathub exception');
    expect(readme).toContain('flatpak-spawn');
    expect(readme).toContain('AI-assisted');
  });

  it('restricts Flathub builds to the published architecture', () => {
    const flathubJson = JSON.parse(readFileSync(FLATHUB_JSON, 'utf8'));
    expect(flathubJson).toEqual({ 'only-arches': ['x86_64'] });
  });
});
