# Drover

Drover is an independent graphical client for [Herdr](https://github.com/herdrdev/herdr). It provides the Herdr workspace, tab, pane, terminal, and agent experience as a native desktop interface while keeping Herdr as the only engine and runtime authority. Drover is not affiliated with or endorsed by the Herdr project.

[Website](https://marcelormendes.github.io/drover/) · [Downloads](https://github.com/marcelormendes/drover/releases/latest)

The project is intentionally not a Herdr fork and not a Herdr plugin. It can track upstream Herdr without maintaining a parallel copy of its engine.

## What works

- Detect, select, and start the installed Herdr CLI and headless server.
- Read canonical workspace, tab, pane, layout, agent, focus, and status data from Herdr.
- Create, focus, reorder, rename, and close workspaces and tabs.
- Group, create, open, focus, and safely remove Git worktrees.
- Display and control multiple live Herdr terminal panes concurrently.
- Split, focus, swap, move, resize, rename, clear, close, and engine-zoom panes without losing terminal continuity.
- Search, copy, safely open links, scroll through Herdr-owned history, and return to terminal bottom.
- Launch every supported agent kind with native arguments and timeout, then focus, rename, or prompt it.
- Paste clipboard images or drop image files into agent chats; they are staged locally and bridged to the agent as pasted paths, the same flow Herdr itself uses.
- Show canonical agent readiness, sessions, metadata, priority ordering, and lifecycle notifications.
- Search the full session with Navigator and use a compact mobile-sized session switcher.
- Inspect and reload agent manifests, manage integrations, and use public Herdr plugins/actions/panes.
- Persist appearance, notification, indicator, pane-label, agent-sort, and sidebar preferences locally.
- Use graphical settings, shortcut help, What's New, update state, and native application menus.
- Recover a terminal controller from the UI if a handoff is released.
- Persist a selected Herdr binary locally without storing Herdr session state.

## Architecture

```text
React renderer
    ↓ typed, context-isolated preload bridge
Electron main process
    ├── Herdr socket API for commands and live session events
    ├── Herdr CLI for status, snapshots, startup, and compatibility
    └── Herdr terminal session control for ANSI frames and input

Herdr remains the owner of workspaces, PTYs, layouts, agents, and persisted state.
```

The renderer is sandboxed and has no Node.js access. IPC senders and payloads are validated, navigation and new windows are denied, permissions default to denied, external URLs are allowlisted, settings are written atomically with user-only permissions, and packaged Electron fuses restrict unsupported runtime paths.

## Requirements

- macOS, Windows, or Linux supported by Electron.
- Node.js 22.12 or newer and npm 11.7 for development.
- A current stable Herdr installation. The app checks the running server protocol instead of bundling or replacing Herdr.

If `herdr` is not on `PATH`, open Settings and choose the executable. For development and automation, `DROVER_BIN=/absolute/path/to/herdr` takes priority over the saved selection.

## Linux

Install the latest release per-user (no root) with one command:

```sh
curl -fsSL https://marcelormendes.github.io/drover/install.sh | sh
```

The installer downloads the AppImage, verifies its SHA-256 against the checksums published with the release, and adds a menu entry under `~/.local/share/applications`. Pin a version with `--version v0.1.8`, remove everything it wrote with `--uninstall`, or grab the AppImage, `.deb`, or `.rpm` manually from the [releases page](https://github.com/marcelormendes/drover/releases/latest).

The AppImage's runtime carries its own FUSE support (statically linked), so the system libfuse libraries are not needed. If launch fails with a FUSE mount error (containers, restricted `/dev/fuse`, or no mount helper), force self-extraction with `APPIMAGE_EXTRACT_AND_RUN=1 drover` (or pass `--appimage-extract-and-run`).

### Flatpak

Every release also publishes a Flatpak bundle as a manual GitHub Release download:

```sh
flatpak install --user ./drover-linux-x86_64.flatpak
flatpak run io.github.marcelormendes.drover
```

Remove it with `flatpak uninstall --user io.github.marcelormendes.drover`.

This bundle is updated by installing a newer release; it is not a Flathub or repository-backed package. Drover requests host command access (`flatpak-spawn --host`) because it controls the host Herdr engine, its sockets, terminals, and SSH tunnels — Flatpak manages installation and desktop integration, not a security boundary between the application and the host.

## Development

```sh
npm install
npm start
```

Useful gates:

```sh
npm run verify
npm run test:package
npm run make
npm outdated
npm audit --omit=dev
```

All dependency versions are saved exactly. Stable releases are used; prerelease package lines are excluded.

## Contributing

Contributions are welcome through pull requests. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development checks, review requirements, and repository security rules. All changes to `main` require passing CI and code-owner review.

## Desktop shortcuts

| Action | Shortcut |
| --- | --- |
| Open engine settings | `Cmd/Ctrl + ,` |
| Open Navigator | `Cmd/Ctrl + K` |
| Open plugins | `Cmd/Ctrl + Shift + P` |
| Refresh the Herdr snapshot | `Cmd/Ctrl + R` |
| Focus workspace 1–9 | `Cmd/Ctrl + 1–9` |
| Focus adjacent pane | `Alt + Arrow` |
| Split right/down | Native Pane menu |
| Toggle pane zoom | `Cmd/Ctrl + Shift + Z` |

The searchable shortcut dialog and native menus list the complete current bindings.

## Theme

The complete interface uses the current [Neobrutalism Components](https://www.neobrutalism.dev/) v4 registry, tokens, typography, borders, shadows, controls, dialogs, menus, tabs, alerts, badges, inputs, selects, tooltips, scroll areas, and notifications. Theme primitives live in `src/index.css`; application code composes the registry components under `src/components/ui`.

## Distribution

`npm run make` produces platform-appropriate Electron Forge artifacts. On macOS this includes a ZIP archive and DMG with the Drover icon. Build intermediates live in the operating system's temporary directory so macOS File Provider metadata cannot contaminate the app signature when the repository is inside Documents or iCloud Drive.

Pushing a version tag such as `v0.1.5`, or manually running the **Release** workflow for the same package version, builds separate Apple Silicon and Intel artifacts. The workflow signs the app with Developer ID, notarizes the app and DMG with Apple, staples the notarization ticket, validates Gatekeeper acceptance, generates SHA-256 checksums, and publishes the files in a GitHub Release. The same release publishes Linux AppImage, DEB, and RPM artifacts built on `ubuntu-latest`. Credentials are held only as encrypted repository secrets.

Windows release automation will be added separately. Local builds without release credentials remain ad-hoc signed and are intended for development only.

## Relationship to Herdr

Drover is an independent client project and is not affiliated with or endorsed by the upstream Herdr project. Herdr and its name belong to the Herdr project and contributors. This repository uses Herdr only to identify the compatible engine; it does not modify Herdr or persist a second source of runtime truth.

### In-app desktop updates

Signed macOS installations offer **Update and restart** from the **Update Drover** button. Drover downloads and verifies the release, installs it, and restarts; the Herdr server and its workspaces continue running. Download failures stay in the dialog with a retry action. Development builds and other installation formats show a manual update option.

The first release containing the native updater requires a one-time manual installation. Subsequent macOS releases publish architecture-specific Squirrel JSON feeds alongside their signed ZIPs. The release workflow generates each feed with `scripts/create-update-feed.mjs` after signature validation, using version-pinned GitHub asset URLs. Automatic replacement must be smoke-tested between two signed packaged releases; a development build cannot verify this step.
