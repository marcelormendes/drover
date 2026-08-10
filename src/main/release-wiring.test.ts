import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFile(path, 'utf8');

describe('macOS release wiring', () => {
  it('builds both Mac architectures from version tags', async () => {
    const workflow = await read('.github/workflows/release.yml');

    expect(workflow).toContain('tags:\n      - "v*"');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('matrix:');
    expect(workflow).toContain('arch: [arm64, x64]');
    expect(workflow).toMatch(/HERDR_DESKTOP_ARCH: [$][{][{] matrix[.]arch [}][}]/u);
    expect(workflow).toContain('npm run verify');
  });

  it('imports the Developer ID certificate and notarizes every DMG', async () => {
    const workflow = await read('.github/workflows/release.yml');

    expect(workflow).toContain('HERDR_MACOS_CERTIFICATE_P12_BASE64');
    expect(workflow).toContain('HERDR_MACOS_CERTIFICATE_PASSWORD');
    expect(workflow).toContain('HERDR_MACOS_SIGN_IDENTITY');
    expect(workflow).toContain('APPLE_ID');
    expect(workflow).toContain('APPLE_TEAM_ID');
    expect(workflow).toContain('APPLE_APP_SPECIFIC_PASSWORD');
    expect(workflow).toContain('xcrun notarytool submit');
    expect(workflow).toContain('xcrun stapler validate');
  });

  it('publishes stable DMG, ZIP, and checksum names to a GitHub Release', async () => {
    const workflow = await read('.github/workflows/release.yml');

    expect(workflow).toMatch(/herdr-desktop-macos-[$][{]RELEASE_ARCH[}][.]dmg/u);
    expect(workflow).toMatch(/herdr-desktop-macos-[$][{]RELEASE_ARCH[}][.]zip/u);
    expect(workflow).toContain('checksums.sha256');
    expect(workflow).toContain('gh release create');
    expect(workflow).toContain('gh release upload');
  });

  it('pins every reusable action to an immutable commit', async () => {
    const workflow = await read('.github/workflows/release.yml');
    const uses = [...workflow.matchAll(/^[ \t]+uses:\s+([^\s#]+)/gmu)].map((match) => match[1]);

    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action).toMatch(/@[0-9a-f]{40}$/u);
    }
  });

  it('keeps the release artifact contract between the Linux build and the release job', async () => {
    const workflow = await read('.github/workflows/release.yml');

    expect(workflow).toContain('name: linux-x64');
    expect(workflow).toContain('pattern: "{macos-*,linux-*}"');
    expect(workflow).toContain('needs: [prepare, macos, linux]');
    expect(workflow).toContain('herdr-desktop-linux-x86_64.AppImage');
    expect(workflow).toContain('herdr-desktop-linux-amd64.deb');
    expect(workflow).toContain('herdr-desktop-linux-x86_64.rpm');
    expect(workflow).toContain('sha256sum herdr-desktop-* > checksums.sha256');
  });

  it('lets the temporary Forge runner select an architecture and avoids ad-hoc re-signing releases', async () => {
    const runner = await read('scripts/forge-in-temp.mjs');
    const forge = await read('forge.config.ts');

    expect(runner).toContain('HERDR_DESKTOP_ARCH');
    expect(forge).toContain('osxSign');
    expect(forge).toContain('osxNotarize');
    expect(forge).toContain('if (forgeConfig.packagerConfig.osxSign)');
  });
});
