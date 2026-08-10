# Design: Flatpak bundle for GitHub Releases

Date: 2026-08-10
Status: Approved (maintainer delegated the choice to the recommended approach)
Author: Herdr Desktop contributors

## Context

Herdr Desktop v0.1.9 publishes AppImage, DEB, and RPM artifacts. Community
feedback favors Flatpak for managed installation and desktop integration, but
Herdr Desktop is unusually host-dependent: it runs the host `herdr` CLI,
connects to Herdr's Unix sockets, controls host PTYs, and uses host SSH tools.

A normal Flatpak sandbox would break those features. Flatpak's supported
mechanism for trusted applications to run host commands is
`flatpak-spawn --host`, which requires access to `org.freedesktop.Flatpak` and
is explicitly a sandbox escape. The package must therefore be honest: Flatpak
manages installation and desktop integration, but does not create a security
boundary between Herdr Desktop and the host.

Flathub is not a target. Its current policy may reject host-dependent
development tools and prohibits AI-generated submission material and
AI-assisted application code. A self-hosted Flatpak repository is also
deferred until the bundle has real users.

## Goal

Publish an additional x86_64 artifact on every GitHub Release:

`herdr-desktop-linux-x86_64.flatpak`

Users can install it per-user with Flatpak, launch the full Herdr Desktop
experience against the host Herdr engine, and uninstall it through Flatpak.
AppImage remains the recommended one-command installation and DEB/RPM remain
native-package alternatives.

## Non-goals

- Flathub submission or a Flathub pull request.
- A self-hosted OSTree repository, `.flatpakref`, or automatic Flatpak updates.
- A meaningful Flatpak sandbox; host control is fundamental to the product.
- Linux arm64, Snap, AUR, or changes to the existing Linux artifact names.
- Triggering a release as part of implementation.

## Package contract

- Application ID: `io.github.marcelormendes.herdr-desktop`.
- Architecture: x86_64 only, matching the current Linux release job.
- Runtime, SDK, and Electron BaseApp: branch `25.08`, the current supported
  Freedesktop/Electron branch at design time.
- Electron launches through the BaseApp's `zypak-wrapper`.
- The bundle records Flathub as its runtime source so installation can resolve
  the Freedesktop runtime. The Electron BaseApp is a build input.
- AppStream metadata, desktop entry, and icons use the application ID exactly.

The build repackages Electron Forge's Linux packaged directory. It must not
introduce a second npm dependency build or a parallel application bundle.

## Host integration

Add one small, tested process-invocation boundary in the Electron main process:

- Outside Flatpak, processes execute exactly as they do today.
- When `FLATPAK_ID` matches the application ID, host-bound commands execute as
  `flatpak-spawn --host <program> <args...>`.
- Apply the boundary consistently to Herdr queries, server launch, terminal
  control, engine update, SSH, and socket-bridge helpers. Do not scatter
  Flatpak conditionals across callers.
- Preserve argument arrays and `shell: false`; never concatenate commands.
- Preserve full-duplex standard I/O for terminal control.
- User-selected `HERDR_DESKTOP_BIN` and persisted binary paths refer to host
  paths and must remain usable through the same bridge.

The manifest grants `--talk-name=org.freedesktop.Flatpak`. Documentation and
metadata must disclose that this permits host command execution.

## Shared paths

Grant only the host paths the desktop genuinely needs, as narrow `xdg-*`
grants:

- `--filesystem=xdg-config/herdr:create` for the Herdr API/client sockets and
  engine configuration (`:create` so a fresh user without a config directory
  yet still gets the core socket mount).
- `--filesystem=xdg-data/herdr-desktop:create` — the single narrow app-owned
  parent grant covering chat-image staging and the remote-engine bridge
  sockets. Overlapping nested `xdg-data` grants are ignored by Flatpak 1.14
  (verified in the disposable bundle: the nested `chat-images`/`remote` grants
  mounted nothing, while the parent exposed both), so the children are never
  granted separately; the application creates both child directories with
  private 0700 permissions.

Flatpak mounts a granted host directory at two aliases: the sandbox sees it
under its private `$XDG_CONFIG_HOME`/`$XDG_DATA_HOME` (e.g.
`$XDG_CONFIG_HOME/herdr`), the host under `$HOST_XDG_CONFIG_HOME`/`$HOST_XDG_DATA_HOME`.
The main process therefore performs explicit, boundary-safe prefix translation
between the two forms:

- Chat images are staged at the sandbox `$XDG_DATA_HOME/herdr-desktop/chat-images`
  and the paths returned to the renderer/agent are translated to the
  host-visible `$HOST_XDG_DATA_HOME/…` form.
- Remote bridge sockets listen at the sandbox `$XDG_DATA_HOME/herdr-desktop/remote`;
  when the tunnel's socket environment is applied for host processes, the
  paths are converted to the host form.
- Socket paths reported by the host `herdr` CLI (host form) are translated to
  the sandbox form centrally at status parsing, before any sandbox-direct
  API/event connection.

Outside Flatpak all translation helpers are identity and temporary-directory
behavior is unchanged. Flatpak's private `/tmp` remains invisible to host
agents, which is why the staging and bridge directories use the grants above.

Do not grant blanket `home` or `host` filesystem access unless live evidence
shows an unavoidable core feature failure and the maintainer approves the
scope expansion.

Remote-engine sockets and subprocesses must also cross the same host boundary.
If their current temporary paths are not visible on both sides, move only
those bridge files to the dedicated shared directory; do not disable remote
engine support in the Flatpak build.

## Flatpak permissions

Start from the official Electron guidance: X11/Xwayland display, IPC, DRI, and
network access, plus the host-command D-Bus permission and the two narrow
filesystem paths above. Add no permission without a tested product need.

Electron's renderer sandbox, context isolation, navigation restrictions, and
application fuses remain enabled. Those are application defenses, distinct
from the intentionally escaped Flatpak boundary.

## Build and release wiring

- Keep Flatpak files under `flatpak/`: manifest, wrapper, desktop entry,
  AppStream metadata, and any package-specific assets.
- Add a focused build command that packages the app with Forge, stages the
  packaged directory under ignored `out/`, runs `flatpak-builder`, exports a
  temporary repository, and creates the single-file bundle.
- The build must fail on missing output, metadata validation errors, or an
  unexpected application ID/runtime.
- Extend the Linux release job to install Flatpak build tooling and the pinned
  runtime/BaseApp, build the bundle, and copy it to
  `dist/release/herdr-desktop-linux-x86_64.flatpak`.
- Upload it in the existing `linux-x64` artifact so the release job's existing
  brace pattern still downloads the complete Linux set.
- Include it in `checksums.sha256` through the existing release glob.
- Extend the release-wiring regression test to pin the filename and build
  contract.

Do not change macOS jobs or existing Linux artifacts except where a shared,
well-tested helper is required.

## User documentation

README and the website should describe the Flatpak as a manual GitHub Release
download:

```sh
flatpak install --user ./herdr-desktop-linux-x86_64.flatpak
flatpak run io.github.marcelormendes.herdr-desktop
```

State that this bundle is updated by installing a newer release; it is not a
Flathub or repository-backed package. Keep the AppImage installer first.
Disclose that Herdr Desktop requests host command access because its purpose is
to control the host Herdr engine and terminals.

## Verification

- Unit tests for direct versus Flatpak process invocation, argument integrity,
  terminal full-duplex spawning, binary overrides, and shared chat-image paths.
- Existing engine, terminal, remote-engine, packaging, security, and release
  tests remain green.
- `npm run verify` and `npm run test:package` pass.
- Validate AppStream metadata and the desktop file.
- Build the bundle in a clean Linux environment, install it into a temporary
  user Flatpak installation, inspect its metadata/permissions, run the
  packaged smoke mode under a virtual display, and uninstall it.
- Exercise `flatpak-spawn --host` with a harmless fixture to prove arguments,
  standard streams, and exit status cross the boundary.
- When practical, live-smoke the installed Flatpak against a running Herdr
  server and open one terminal controller before release approval.

## Delivery gates

The implementation agent may edit local files and run verification only. It
must stop and report before committing, pushing, opening a PR, merging,
tagging, or dispatching a release workflow.

After independent review:

1. Approve or request local changes.
2. If approved, authorize the agent to commit, push, and open a PR.
3. Review CI and the PR before separately authorizing merge.
4. Review the merged state before separately authorizing a version bump, tag,
   or release workflow dispatch.
