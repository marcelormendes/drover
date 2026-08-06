# Herdr Desktop

Herdr Desktop is a standalone graphical client for [Herdr](https://github.com/herdrdev/herdr). It provides the Herdr workspace, tab, pane, terminal, and agent experience as a native desktop interface while keeping Herdr as the only engine and runtime authority.

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

If `herdr` is not on `PATH`, open Settings and choose the executable. For development and automation, `HERDR_DESKTOP_BIN=/absolute/path/to/herdr` takes priority over the saved selection.

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

`npm run make` produces platform-appropriate Electron Forge artifacts. On macOS this includes a ZIP archive and DMG with the project icon. Build intermediates live in the operating system's temporary directory so macOS File Provider metadata cannot contaminate the app signature when the repository is inside Documents or iCloud Drive.

Local macOS artifacts are ad-hoc signed and validated, but not notarized. Public distribution should add Developer ID signing and Apple notarization or Windows code signing in the release environment; credentials are deliberately not stored in this repository.

## Relationship to Herdr

Herdr Desktop is an independent client project. Herdr and its name belong to the upstream Herdr project and contributors. This repository does not modify Herdr and does not persist a second source of runtime truth.
