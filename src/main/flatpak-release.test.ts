import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FLATPAK_APP_ID,
  FLATPAK_BRANCH,
  FLATPAK_BUNDLE_NAME,
  FLATPAK_RUNTIME_VERSION,
  flatpakManifestSources,
  flatpakStagedSourcePaths,
  probeTool,
} from '../../scripts/build-flatpak.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST = path.join(ROOT, 'flatpak', `${FLATPAK_APP_ID}.yml`);
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build-flatpak.mjs');
const CI_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const RELEASE_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'release.yml');

const flatpakBuilderAvailable =
  spawnSync('sh', ['-c', 'command -v flatpak-builder'], {
    stdio: 'ignore',
  }).status === 0;

describe('Flatpak packaging contract', () => {
  it('pins the application ID, branch, runtime, and bundle name', () => {
    expect(FLATPAK_APP_ID).toBe('io.github.marcelormendes.drover');
    expect(FLATPAK_BRANCH).toBe('stable');
    expect(FLATPAK_RUNTIME_VERSION).toBe('25.08');
    expect(FLATPAK_BUNDLE_NAME).toBe('drover-linux-x86_64.flatpak');
  });

  it('resolves staged manifest sources against the staged directory layout', () => {
    const staged = path.join(ROOT, 'out', 'flatpak', 'flatpak-src');
    const resolved = flatpakStagedSourcePaths(staged, MANIFEST);

    const appSource = resolved.find((source) => source.type === 'dir');
    expect(appSource?.resolved).toBe(path.join(ROOT, 'out', 'flatpak', 'flatpak-app'));

    for (const file of [
      'drover-wrapper.sh',
      `${FLATPAK_APP_ID}.desktop`,
      `${FLATPAK_APP_ID}.metainfo.xml`,
      'icon-512.png',
      'icon.svg',
    ]) {
      const source = resolved.find(
        (candidate) => candidate.type === 'file' && candidate.path === file,
      );
      expect(source?.resolved).toBe(path.join(staged, file));
    }
  });

  it('keeps the manifest source set internally consistent with the repo layout', () => {
    const sources = flatpakManifestSources(MANIFEST);
    expect(sources.map((source) => source.path)).toEqual([
      '../flatpak-app',
      'drover-wrapper.sh',
      `${FLATPAK_APP_ID}.desktop`,
      `${FLATPAK_APP_ID}.metainfo.xml`,
      'icon-512.png',
      'icon.svg',
    ]);
    // The dir source must rename itself so the `cp -a flatpak-app/.` build
    // command sees a flatpak-app subdirectory in the module build root.
    expect(sources[0]).toMatchObject({ type: 'dir', dest: 'flatpak-app' });
    // The icons and metadata files live next to the committed manifest; the
    // staged app directory is produced by the build script.
    for (const file of [
      'drover-wrapper.sh',
      `${FLATPAK_APP_ID}.desktop`,
      `${FLATPAK_APP_ID}.metainfo.xml`,
      'icon-512.png',
      'icon.svg',
    ]) {
      expect(existsSync(path.join(ROOT, 'flatpak', file))).toBe(true);
    }
  });

  it('uses the official stable branch and build-bundle NAME BRANCH form', () => {
    const manifest = readFileSync(MANIFEST, 'utf8');
    const script = readFileSync(BUILD_SCRIPT, 'utf8');

    expect(manifest).toContain('default-branch: stable');
    expect(manifest).toContain('patch-electron-desktop-filename');
    expect(manifest).toContain('xdg-config/herdr:create');
    // One narrow app-owned parent: Flatpak 1.14 ignores overlapping nested
    // xdg-data grants, so the children must never be granted separately.
    expect(manifest).toContain('xdg-data/drover:create');
    expect(manifest).not.toContain('xdg-data/drover/chat-images:create');
    expect(manifest).not.toContain('xdg-data/drover/remote:create');
    expect(manifest).toContain('hicolor/512x512/apps/io.github.marcelormendes.drover.png');
    expect(script).toContain("'--default-branch=stable'");
    expect(script).toContain("'--arch=x86_64'");
    expect(script).toContain('FLATPAK_APP_ID,\n    FLATPAK_BRANCH,');
  });

  it('keeps the config permission probe before every flatpak run', () => {
    const ci = readFileSync(CI_WORKFLOW, 'utf8');
    const steps = [
      'Exercise the herdr config host-visible permission contract',
      'Smoke-run the app under a virtual display',
      'Exercise flatpak-spawn --host argument and stdio crossing',
      'Exercise the app data host-visible permission contract',
      'Uninstall the application',
    ];
    const indexes = steps.map((name) => ci.indexOf(name));
    expect(indexes.every((index) => index >= 0)).toBe(true);
    for (let index = 1; index < indexes.length; index += 1) {
      expect(indexes[index]).toBeGreaterThan(indexes[index - 1]);
    }
  });

  it('pins the Flatpak build, install, smoke, and uninstall in CI', () => {
    const ci = readFileSync(CI_WORKFLOW, 'utf8');
    const release = readFileSync(RELEASE_WORKFLOW, 'utf8');

    expect(ci).toContain('flatpak:');
    expect(ci).toContain('npm run build:flatpak');
    expect(ci).toContain('appstream-compose');
    expect(ci).toContain('FLATPAK_USER_DIR=');
    expect(ci).toContain('Assert the test installation is empty');
    expect(ci).toContain('flatpak install --user --noninteractive');
    expect(ci).toContain(
      'dbus-run-session -- xvfb-run -a flatpak run --user --env=DROVER_SMOKE_TEST=1',
    );
    expect(ci).toContain('dbus-run-session -- bash -euo pipefail');
    expect(ci).toContain('Exercise flatpak-spawn --host argument and stdio crossing');
    expect(ci).toContain('--host --watch-bus');
    expect(ci).toContain("grep -Fxq 'fp-probe-stderr-sentinel'");
    expect(ci).toContain('Exercise the app data host-visible permission contract');
    expect(ci).toContain('Exercise the herdr config host-visible permission contract');
    expect(ci).toContain('HOST_XDG_CONFIG_HOME');
    expect(ci).toContain('hicolor/512x512/apps');
    expect(ci).toContain('flatpak uninstall --user --noninteractive');
    expect(release).toContain('appstream-compose');
    expect(release).toContain('npm run build:flatpak');
    expect(release).toContain('drover-linux-x86_64.flatpak');
  });

  it('probes tool presence without rejecting tools that lack --version support', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'fp-tool-'));
    const fakeTool = path.join(tmp, 'fake-tool');
    writeFileSync(fakeTool, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    try {
      const env = { ...process.env, PATH: `${tmp}:${process.env.PATH ?? ''}` };
      // Exists but exits non-zero for --version (desktop-file-validate
      // behavior): must still be considered present.
      expect(probeTool('fake-tool', { env })).toBe(true);
      expect(probeTool('fake-tool-definitely-missing', { env })).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('invokes the build through the CLI entry point (missing-tool failure proves main runs)', {
    skip: flatpakBuilderAvailable,
  }, () => {
    const result = spawnSync(process.execPath, [BUILD_SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, HOME: process.env.HOME },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('flatpak-builder is required');
  });
});
