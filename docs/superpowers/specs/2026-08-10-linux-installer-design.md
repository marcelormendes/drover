# Design: Linux support via AppImage + curl installer

Date: 2026-08-10
Status: Proposed
Author: Drover contributors (session with maintainer)

## Context

Drover is an Electron client for the Herdr engine. Linux is already
supported at build time — `forge.config.ts` wires `MakerDeb` and `MakerRpm`,
and the app itself is cross-platform Electron 43 — but no Linux artifacts are
published: the only release workflow (`release-macos.yml`) builds and signs
macOS DMG/ZIP only, and README/site direct Linux users to nothing.

The maintainer wants the easiest possible Linux onboarding: a single curl
command, no sudo, no manual steps.

### Community landscape (grounded)

- Flatpak is the community's general desktop favorite (auto-updates, sandbox,
  Flathub review), but it is a poor fit here: Drover execs the `herdr`
  CLI, connects to sockets under `~/.config/herdr`, and drives live PTYs. A
  Flatpak sandbox would require broad `filesystem: home` grants (making the
  sandbox cosmetic) or break core features. Same reasoning rejects Snap.
- AppImage is the community-accepted format for GitHub-distributed indie apps:
  single file, no install, distro-agnostic. Its known gaps (no updates, no
  central registry, scattered files) are addressed by the installer in this
  design (re-run to update, `--uninstall`, install to standard locations with a
  `.desktop` entry).

## Goal

A Linux user runs:

```sh
curl -fsSL https://marcelormendes.github.io/drover/install.sh | sh
```

and ends up with Drover installed per-user (no root), discoverable in
the application menu, with a checked prerequisite (Herdr CLI) and a printed
next step.

## Non-goals

- Flatpak/Snap distribution (rejected above; revisit only if demand appears).
- Linux arm64 artifacts (x64 only in v1; architecture is wired end-to-end so
  arm64 is a one-line CI matrix addition later).
- Auto-update inside the app (out of scope; re-running the one-liner is the
  update path).
- AUR package, Windows release automation.
- Changes to Herdr itself or to the app's runtime behavior.

## Asset contract (release pipeline must satisfy this)

Artifacts published to every GitHub Release, with stable names:

| Asset | Name |
| --- | --- |
| AppImage | `drover-linux-x86_64.AppImage` |
| Debian package | `drover-linux-amd64.deb` |
| RPM package | `drover-linux-x86_64.rpm` |
| Checksums | `checksums.sha256` (all platform artifacts) |

URLs (installer depends on these):

- Latest: `https://github.com/marcelormendes/drover/releases/latest/download/<asset>`
- Pinned: `https://github.com/marcelormendes/drover/releases/download/<tag>/<asset>`
- `checksums.sha256` resolves at the same base as the asset.

## Design

### 1. Release pipeline

**Dependencies** (dev, exact pins):
- `@reforged/maker-appimage@5.2.0` — the maintained reimplementation of the
  original forge AppImage maker (the original `@electron-forge/maker-appimage`
  is gone from the npm registry; verified 404). It composes the AppImage in
  TypeScript using the system `mksquashfs` binary and fetches the AppImage
  type-2 runtime from GitHub at build time.
- `electron-installer-debian@4.0.0` and `electron-installer-redhat@4.0.0` —
  **required by Forge 7.11.2's `MakerDeb`/`MakerRpm`**: their
  `isSupportedOnCurrentPlatform()` is `isInstalled('electron-installer-debian'
  /'electron-installer-redhat')`, and `maker-base.isInstalled` does a project
  `require()` of the module. Neither is a dependency of the makers or the CLI
  (verified in the 7.11.2 dependency trees), so without them `npm run make`
  on Linux aborts with "the maker declared that it cannot run on linux" —
  before any artifact (including the AppImage) is produced. The system
  binaries they need (`dpkg`, `fakeroot`, `rpmbuild`) are already on the
  ubuntu-latest runner image; no fpm is needed (fpm was the Forge 6
  mechanism).

**`forge.config.ts`**: add the maker:

```ts
new MakerAppImage({
  options: {
    bin: 'Drover',
    icon: 'resources/icon.svg',
    categories: ['Development', 'Utility'],
  },
})
```

- `bin` must equal `packagerConfig.executableName` (`'Drover'`): the
  maker's default is the sanitized package name (`drover`), which does
  not exist in the packaged app, and its source throws "Could not find
  executable" in that case (verified in maker source v5.2.0).
- `icon: 'resources/icon.svg'` exists in the repo; the maker embeds it into the
  AppImage's hicolor icon store and references it from the generated
  `.desktop` file.
- The maker generates the embedded `.desktop` entry from these options plus
  package metadata (Name, Exec, Icon, Categories, version markers).

**Workflow rename**: `.github/workflows/release-macos.yml` →
`.github/workflows/release.yml` (display name "Release"). The macOS jobs are
unchanged; **`src/main/release-wiring.test.ts` hard-codes the old filename in
four tests (lines 8, 19, 32, 42) and runs inside `npm run verify`, so it must
be updated to read `release.yml` in the same change** — otherwise the rename
breaks CI, the workflow's own `prepare` job, and the new `linux` job. Add:

- New `linux` job: `runs-on: ubuntu-latest`, `npm ci`, `npm run verify`,
  install build deps (`sudo apt-get install -y squashfs-tools`; `dpkg`,
  `fakeroot`, `rpmbuild` are preinstalled on the runner), then `npm run make`
  (produces `.deb`, `.rpm`, and the AppImage). Rename outputs to the stable
  asset names above. Upload with `actions/upload-artifact` under the name
  `linux` (so the `linux-*` download pattern below matches).
- `release` job: `needs: [prepare, macos, linux]` (the spec's download
  pattern change alone would race the release job); download `macos-*` and
  `linux-*` artifacts (`actions/download-artifact` pattern
  `macos-*` + `linux-*`, `merge-multiple: true`); checksum glob becomes
  `sha256sum drover-* > checksums.sha256`; the existing
  `gh release upload dist/release/*` then publishes everything in one release.

### 2. Installer script — `scripts/install.sh` (new)

Single source of truth lives in `scripts/`; the site build copies it to the
site output so it is served at
`https://marcelormendes.github.io/drover/install.sh`.

**`scripts/build-site.mjs`**: add one `copyFile` of `scripts/install.sh` →
`dist/site/install.sh`.

**`.github/workflows/pages.yml`**: add `"scripts/install.sh"` to the deploy
trigger paths (so installer changes redeploy the site).

**Script contract** (POSIX `sh`, `set -eu`, no sudo, no prompts):

0. Prerequisites: require `$HOME` set (`${HOME:?}`) and
   `command -v curl sha256sum` present; fail with a clear message otherwise.
1. Require Linux; map `uname -m` → asset name
   (`x86_64` → `drover-linux-x86_64.AppImage`; `aarch64` → clear
   "not published yet" error; anything else → unsupported arch error).
2. Resolve download URL: default latest; `--version <tag>` pins to
   `releases/download/<tag>`.
3. Download asset + `checksums.sha256` to a `mktemp -d` directory with
   `curl -fSL -O` (basenames match for both latest and pinned URLs; checksum
   file failure is fatal — no silent unverified installs).
4. Verify only the target asset's checksum — the published file contains
   entries for every platform artifact (macOS included), and
   `sha256sum -c` over the whole file would fail on the absent entries and
   abort under `set -eu`:
   `grep -F 'drover-linux-x86_64.AppImage' checksums.sha256 | sha256sum -c -`
   Mismatch aborts with a clear message.
5. Install per-user:
   - AppImage → `~/.local/bin/drover` (0755, atomic via temp+rename).
   - Icon → `~/.local/share/icons/hicolor/1024x1024/apps/drover.png`
     (downloaded from the site's `icon.png`, which is 1024×1024 — install at
     the matching hicolor size; **best-effort**: an icon failure must not
     abort the install).
   - Entry → `~/.local/share/applications/drover.desktop`
     (`Exec=<absolute path>`; `Icon=drover`; `Type=Application`;
     `Categories=Development;Utility;`).
6. Best-effort `update-desktop-database` (ignore failure — helper may not
   exist).
7. Check `command -v herdr`; if missing, print a warning with the upstream
   Herdr install link (non-fatal — the app itself also detects and prompts).
   Also check `~/.local/bin` is on `PATH` (`case :$PATH: in
   *:$HOME/.local/bin:*)`) and print the absolute path or a PATH hint when
   absent (Debian/Ubuntu do not include it by default).
8. Print the installed version (parsed from curl's `%{url_effective}` after
   the latest redirect) and next steps: run `drover`; uninstall via
   `--uninstall`.

**Flags**: `--version <tag>` (pin), `--uninstall` (removes exactly the three
files written, in safe order), `--base-url <url>` (advanced/test hook; allows
`file://` fixtures for local verification), `--help`.

**Idempotency**: re-running overwrites the AppImage (update) and rewrites the
entry/icon.

### 3. Docs, tests & site

- **`src/main/release-wiring.test.ts`**: update the four hard-coded
  `release-macos.yml` paths to `release.yml` (required by the workflow rename;
  see above).
- **README.md**: new "Linux" subsection under Requirements/Distribution with
  the one-liner and the manual download link; replace "Release macOS workflow"
  references with "Release workflow"; note FUSE (`fuse2`) only matters for
  double-click launch of AppImages.
- **site/index.html**: install section gains a Linux option — the curl
  one-liner as the recommended path (keep macOS DMG copy intact).

## Verification

- `npm run verify` (typecheck, lint, vitest, site build) — CI already runs it.
- Local smoke on the maintainer machine:
  1. `pacman -S squashfs-tools` (build dep for the AppImage maker).
  2. Build only the AppImage maker to avoid the deb/rpm installer deps:
     `npx electron-forge make --targets=AppImage` — the target must be
     `AppImage` (the maker's `name`); a string target that matches no
     configured maker fails CLI target resolution before any maker runs.
     Assert `out/make/AppImage/x64/Drover-<version>-x64.AppImage`
     exists.
  3. Exercise `scripts/install.sh` against a `file://` fixture (AppImage +
     checksums.sha256 + icon.png in a temp dir, `--base-url file://…`, temp
     `HOME`): assert binary/icon/desktop written, checksum mismatch aborts,
     `--uninstall` removes exactly the three files (the fixture includes
     icon.png so the best-effort icon step runs).
  4. Launch assertion: execute the installed AppImage once with the fixture
     HOME (or `APPIMAGE_EXTRACT_AND_RUN=1` where FUSE is absent) and confirm
     the process starts — guards the FUSE-independent launch claim that the
     `.desktop` entry depends on.
- `npm run test:package` (existing packaged-app smoke test, Linux-capable).
- The `linux` release job proves out on the next tag push (maintainer's git
  step).

## Risks & mitigations

- **Maker compat with forge 7.11.2/Electron 43**: verified the maker declares
  `@electron-forge/maker-base ^6 || ^7` and works from packaged output; the
  local build test (above) is the real gate. Fallback if it fails: a scripted
  `appimagetool` step in CI (no new dependency, ~15 lines).
- **CI runner lacks `mksquashfs`**: installed explicitly in the linux job;
  deterministic. The deb/rpm makers' npm modules are added as exact
  devDependencies (their system binaries are preinstalled on ubuntu-latest).
- **`curl | sh` trust**: standard practice for this app class; mitigated by
  (a) script served over HTTPS from the project site, (b) SHA-256 verification
  against release-published checksums before anything is installed, (c) install
  confined to `~/.local` with no root.
- **Electron sandbox on distros without unprivileged user namespaces**: AppImage
  runs with user permissions; modern distros (Ubuntu 23.10+, Fedora, Arch,
  Debian 12+) enable unprivileged userns. Documented known limitation; the
  `.deb`/`.rpm` remain the alternative for affected systems.
- **FUSE for double-click**: only needed for launching the AppImage by
  double-click; `sh`-based launch and the installed `~/.local/bin` path are
  FUSE-independent.

## Out of scope / future

- arm64 Linux, Flatpak/Snap, AUR, in-app auto-update, Windows releases.

## Post-review implementation notes (herdr agent rev1, 2026-08-10)

All findings resolved; deviations from this spec are recorded here:

- **download-artifact pattern**: `actions/download-artifact` compiles the
  whole `pattern` input into ONE Minimatch — comma-separated globs match
  nothing. Final: Linux artifacts upload under `linux-x64` and the release job
  downloads `"{macos-*,linux-*}"` (brace alternation). A regression test pins
  this contract (`release-wiring.test.ts`).
- **AppImage runtime pinning**: the maker's default fetches the type-2 runtime
  from the mutable `continuous` release. The runtime is now vendored at
  `resources/appimage-runtime-x86_64` (sha256
  `1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf`) and
  passed via `options.runtime`, so builds embed a pinned runtime.
- **FUSE reality**: empirically, the type-2 runtime auto-falls back to
  extraction when FUSE 2 is absent (verified on a FUSE 3-only host, exit 0
  without `APPIMAGE_EXTRACT_AND_RUN`). Docs now state the fallback and the
  `libfuse2`/`fuse2` package notes instead of claiming FUSE-free shell launch.
- **Installer hardening**: staging is now inside `~/.local/bin` with the mode
  set before a same-filesystem atomic rename; the printed version uses
  `--version` or "the latest release" (the effective-URL parse failed on the
  release-assets CDN redirect).
- **Regression coverage**: `src/test/install-script.test.ts` (6 fixture-based
  tests: install, idempotency, checksum-mismatch abort, missing-entry abort,
  uninstall, flags) plus the release artifact-contract test.
- Unrelated pre-existing lint break (`noUselessFragments` in
  `src/renderer/worktrees/WorktreeSpaces.tsx`) was fixed to keep `npm run
  verify` green.
