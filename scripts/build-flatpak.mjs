import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import forgeCore from '@electron-forge/core';

export const FLATPAK_APP_ID = 'io.github.marcelormendes.drover';
export const FLATPAK_BRANCH = 'stable';
export const FLATPAK_RUNTIME_VERSION = '25.08';
export const FLATPAK_ARCH = 'x86_64';
export const FLATPAK_BUNDLE_NAME = 'drover-linux-x86_64.flatpak';
const FLATHUB_REPO_URL = 'https://dl.flathub.org/repo/flathub.flatpakrepo';
const FLATHUB_RUNTIME_REPO = 'https://dl.flathub.org/repo/flathub.flatpakrepo';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'out', 'flatpak');
const packagedDir = path.join(outDir, 'Drover-linux-x64');
const stagedAppDir = path.join(outDir, 'flatpak-app');
const stagedSourceDir = path.join(outDir, 'flatpak-src');
const repoDir = path.join(outDir, 'repo');
const stateDir = path.join(outDir, 'state');
const buildDir = path.join(outDir, 'build');
const bundlePath = path.join(outDir, FLATPAK_BUNDLE_NAME);
const stagedManifestPath = path.join(stagedSourceDir, `${FLATPAK_APP_ID}.yml`);
const stagedMetainfoPath = path.join(stagedSourceDir, `${FLATPAK_APP_ID}.metainfo.xml`);

/**
 * Parses the `type:`/`path:` pairs of the manifest's module sources. The
 * manifest is staged under `out/flatpak/flatpak-src`, so every source path is
 * resolved relative to that staged directory. Exported for the release-wiring
 * regression tests that pin the layout contract.
 */
export function flatpakManifestSources(manifestPath) {
  const lines = readFileSync(manifestPath, 'utf8').split('\n');
  const sources = [];
  for (let index = 0; index < lines.length; index += 1) {
    const typeMatch = lines[index]?.match(/^\s+- type: (dir|file)\s*$/);
    if (!typeMatch) {
      continue;
    }
    const source = { type: typeMatch[1] };
    let cursor = index + 1;
    while (cursor < lines.length) {
      const keyMatch = lines[cursor]?.match(/^\s+([a-zA-Z0-9_-]+): (.+)\s*$/);
      if (!keyMatch) {
        break;
      }
      if (keyMatch[1] === 'path') {
        source.path = keyMatch[2];
      } else if (keyMatch[1] === 'dest') {
        source.dest = keyMatch[2];
      }
      cursor += 1;
    }
    if (!source.path) {
      throw new Error(`Flatpak source at line ${index + 1} is missing a path.`);
    }
    sources.push(source);
  }
  return sources;
}

export function flatpakStagedSourcePaths(
  stagedDir,
  manifestPath = path.join(stagedDir, `${FLATPAK_APP_ID}.yml`),
) {
  return flatpakManifestSources(manifestPath).map((source) => ({
    ...source,
    resolved: path.resolve(stagedDir, source.path),
  }));
}

function run(program, args, { cwd = root } = {}) {
  const result = spawnSync(program, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${program} exited with ${result.status ?? result.signal}.`);
  }
}

/**
 * True when the program can be spawned. Presence is detected by the spawn
 * error (ENOENT), not the exit code: some tools (desktop-file-validate)
 * return non-zero for `--version` while being perfectly installed. Exported
 * for the release-wiring regression tests.
 */
export function probeTool(program, { env = process.env } = {}) {
  const result = spawnSync(program, ['--version'], { env, stdio: 'ignore' });
  return result.error === undefined;
}

function checkTool(program) {
  if (!probeTool(program)) {
    throw new Error(
      `${program} is required to build the Flatpak bundle. Install flatpak tooling (flatpak, flatpak-builder, appstream, desktop-file-utils) and retry.`,
    );
  }
}

async function assertManifestContract() {
  const manifest = await readFile(stagedManifestPath, 'utf8');
  if (!manifest.includes(`app-id: ${FLATPAK_APP_ID}`)) {
    throw new Error(`Unexpected Flatpak application ID in ${stagedManifestPath}.`);
  }
  if (!manifest.includes(`runtime-version: '${FLATPAK_RUNTIME_VERSION}'`)) {
    throw new Error(`Unexpected Flatpak runtime version in ${stagedManifestPath}.`);
  }
  if (!manifest.includes(`default-branch: ${FLATPAK_BRANCH}`)) {
    throw new Error(`Unexpected Flatpak branch in ${stagedManifestPath}.`);
  }
}

function assertStagedSourcesResolve() {
  const missing = flatpakStagedSourcePaths(stagedSourceDir).filter(
    (source) => !existsSync(source.resolved),
  );
  if (missing.length > 0) {
    throw new Error(
      `Flatpak source paths do not resolve in the staged layout: ${missing
        .map((source) => `${source.path} (${source.resolved})`)
        .join(', ')}`,
    );
  }
}

async function main() {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (process.arch !== 'x64') {
    throw new Error(`Flatpak bundles are built for x86_64; this machine is ${process.arch}.`);
  }

  checkTool('flatpak-builder');
  checkTool('appstreamcli');
  checkTool('desktop-file-validate');

  // 1. Package the application once with Forge and stage the Linux directory
  //    under the ignored out/ tree.
  await rm(outDir, { force: true, recursive: true });
  await mkdir(outDir, { recursive: true });
  await forgeCore.api.package({ arch: 'x64', dir: root, outDir, interactive: false });
  await cp(packagedDir, stagedAppDir, { recursive: true });

  // 2. Stage the manifest set and inject the current package version and
  //    build date into the AppStream release entry (never hardcode them).
  await cp(path.join(root, 'flatpak'), stagedSourceDir, { recursive: true });
  const metainfo = (await readFile(stagedMetainfoPath, 'utf8'))
    .replaceAll('__VERSION__', version)
    .replaceAll('__DATE__', new Date().toISOString().slice(0, 10));
  await writeFile(stagedMetainfoPath, metainfo, 'utf8');

  await assertManifestContract();
  assertStagedSourcesResolve();

  // 3. Resolve the Freedesktop runtime, SDK, and Electron BaseApp from
  //    Flathub so the bundle records Flathub as its runtime source.
  run('flatpak', ['remote-add', '--user', '--if-not-exists', 'flathub', FLATHUB_REPO_URL]);

  // 4. Build and export a temporary repository on the stable branch.
  run('flatpak-builder', [
    '--user',
    '--arch=x86_64',
    '--default-branch=stable',
    '--state-dir',
    stateDir,
    '--repo',
    repoDir,
    '--install-deps-from=flathub',
    '--force-clean',
    buildDir,
    stagedManifestPath,
  ]);

  // 5. Validate metadata and the desktop entry; missing validators already
  //    failed above via checkTool.
  run('appstreamcli', ['validate', '--no-net', stagedMetainfoPath]);
  run('desktop-file-validate', [path.join(stagedSourceDir, `${FLATPAK_APP_ID}.desktop`)]);

  // 6. Create the single-file bundle with Flathub recorded as its runtime
  //    source, using the official NAME BRANCH form.
  run('flatpak', [
    'build-bundle',
    '--runtime-repo',
    FLATHUB_RUNTIME_REPO,
    repoDir,
    bundlePath,
    FLATPAK_APP_ID,
    FLATPAK_BRANCH,
  ]);

  const stats = spawnSync('stat', ['-c', '%s', bundlePath], { encoding: 'utf8' });
  if (stats.status !== 0 || Number(stats.stdout.trim()) === 0) {
    throw new Error(`Flatpak bundle was not produced at ${bundlePath}.`);
  }
  console.log(`Flatpak bundle written to ${bundlePath}`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch((error) => {
    console.error(`Flatpak build failed: ${error.message}`);
    process.exit(1);
  });
}
