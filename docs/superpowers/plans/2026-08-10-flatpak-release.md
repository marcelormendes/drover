# Flatpak GitHub Release implementation plan

Design: `docs/superpowers/specs/2026-08-10-flatpak-release-design.md`

## Guardrails

- Work only in `/home/marcelorm/workspace/drover` on `main`, whose only
  starting changes are this approved plan and its design document.
- Do not commit, push, open a PR, merge, tag, bump the version, publish an
  artifact, or dispatch a workflow.
- Preserve AppImage, DEB, RPM, macOS, installer, and update behavior.
- Use TDD for runtime behavior changes and keep public functions near the top.
- Prefer one process-invocation abstraction over Flatpak branches in callers.

## Task 1: Establish the Flatpak contract with tests

1. Add shared constants for the Flatpak application ID and environment
   detection.
2. Add failing tests that prove host-bound invocations are unchanged normally
   and are prefixed with `flatpak-spawn --host` only inside this Flatpak.
3. Cover spaces and metacharacters in binary paths/arguments to prove no shell
   interpolation is introduced.

## Task 2: Route every host process through one boundary

1. Implement a small invocation value/helper returning program plus argument
   prefix.
2. Apply it to the Herdr command runner, server launcher, terminal controller,
   and remote-engine SSH/socket helpers.
3. Preserve injectability in existing tests and add full-duplex terminal
   spawning coverage.
4. Ensure default, environment-selected, and persisted Herdr binary paths are
   interpreted as host paths in Flatpak mode.

## Task 3: Make socket and chat-image paths host-visible

1. Add tests for Flatpak versus native chat-image staging directories and for
   the explicit host<->sandbox XDG prefix translation (boundary-safe, identity
   outside Flatpak).
2. Use the single narrow app-owned parent grant
   (`xdg-data/drover:create`) in Flatpak mode: stage at the sandbox
   `$XDG_DATA_HOME` alias under `drover/chat-images` (0700), return
   `$HOST_XDG_DATA_HOME`-form paths to the renderer/agent, with collision-safe
   filenames. Overlapping nested `xdg-data` grants are ignored by Flatpak
   1.14, so children are never granted separately.
3. Place remote bridge sockets under the same parent grant
   (`drover/remote`, created 0700 by `createTcpBridge`); convert the
   tunnel socket environment to host form before host processes see it, and
   translate host-form sockets reported by `herdr status` to the sandbox form
   centrally at status parsing.
4. Confirm direct Herdr API/event sockets under `xdg-config/herdr:create`
   remain reachable with the planned manifest permission, via the same
   host->sandbox translation; the `:create` flag covers fresh users whose
   config directory does not exist yet.

## Task 4: Add deterministic Flatpak packaging

1. Add the manifest, Zypak launch wrapper, desktop entry, AppStream metadata,
   and correctly named icons under `flatpak/`.
2. Use `org.freedesktop.Platform`, `org.freedesktop.Sdk`, and
   `org.electronjs.Electron2.BaseApp` branch `25.08`.
3. Package the Forge Linux directory once, stage it under ignored `out/`, and
   create `drover-linux-x86_64.flatpak` with the Flathub runtime URL.
4. Make Electron use the Flatpak desktop filename without changing desktop
   identity on macOS, AppImage, DEB, or RPM.
5. Validate metadata and fail clearly when tooling or inputs are missing.

## Task 5: Wire CI and release artifacts

1. Extend the existing Linux job with the minimal Flatpak tooling/runtime
   setup and bundle build.
2. Copy the stable bundle name into `dist/release` and keep it inside the
   existing `linux-x64` artifact.
3. Extend release-wiring tests to pin the Flatpak build command, artifact name,
   release dependency, and checksum inclusion.
4. Do not duplicate `npm run verify` or rebuild unrelated platform artifacts.

## Task 6: Document installation and trust model

1. Add manual install/run/uninstall instructions to README and the website.
2. Keep the AppImage installer as the recommended Linux path.
3. State that this GitHub bundle has no repository-backed automatic updates.
4. State that host command access is intentional and means Flatpak is not a
   sandbox boundary for Drover.

## Task 7: Verify and hand back

1. Run focused tests during development, then `npm run verify` and
   `npm run test:package`.
2. In a clean Linux environment, build, install, inspect, smoke-run, and
   uninstall the Flatpak. Record exact commands and results.
3. Prove host command argument/stdin/stdout/stderr/exit propagation with a
   harmless fixture. If possible, live-smoke a Herdr connection and terminal.
4. Run `git diff --check`, inspect the complete diff, and report changed files,
   verification evidence, limitations, and any unverified assumptions.
5. Stop. Ask the reviewer for approval before any git or release operation.
