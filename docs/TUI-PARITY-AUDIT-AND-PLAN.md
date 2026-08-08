# Herdr TUI parity audit and 0.1.5 development plan

Status: implementation complete; release verification in progress  
Desktop baseline: `0.1.0`, 59 passing tests  
Upstream baseline: `herdrdev/herdr` `fc824b99aba9389ffda75f19b3a4aee0ff6ca8b5`  
Audit date: 2026-08-06

## Goal and scope

Herdr Desktop must offer a graphical equivalent for every user-facing workflow in the current Herdr TUI while Herdr remains the only runtime and session authority. The desktop client must not fork Herdr state, reconstruct PTYs, or couple itself to Herdr's private client socket.

The comparison source is the current upstream TUI mode list, action/keybinding model, context menus, settings screens, public JSON API, event subscription, and `terminal session control` adapter. CLI-only automation and reporter methods are catalogued but do not become buttons unless the TUI exposes the same workflow.

Parity means equivalent capability, not terminal-shaped imitation:

- TUI prefix and navigate modes become native shortcuts, menus, focus traversal, and a command palette.
- TUI copy mode becomes graphical selection, engine-owned scrolling, search, and explicit copy controls.
- Closing the desktop window is the graphical detach action; it must never stop Herdr or its PTYs.
- The desktop visual language remains the current neobrutalism.dev v4 theme. Herdr's terminal-only palette selector is represented by supported desktop appearance controls without importing unrelated TUI themes.
- All workspace, tab, pane, agent, worktree, layout, integration, and lifecycle mutations go through Herdr's public API or CLI.

## Authoritative upstream inventory

The current TUI has these explicit modes:

1. Onboarding
2. Release notes
3. Product announcement
4. Navigate
5. Prefix
6. Copy
7. Terminal
8. Rename workspace
9. Rename tab
10. Rename pane
11. New linked worktree
12. Open existing worktree
13. Confirm worktree removal
14. Resize
15. Confirm close
16. Context menu
17. Settings
18. Global menu
19. Keybinding help
20. Navigator

The main action inventory includes workspace and worktree lifecycle, workspace picker and navigator, detach, reload configuration, notification targeting, workspace/agent/tab cycling, indexed selection, tab lifecycle, pane rename and scrollback editing, copy mode, directional pane focus and swapping, pane cycling, split, close, zoom, resize, sidebar toggling, and custom commands.

The TUI settings surface contains exactly six sections: theme, status indicators, sound, notification delivery, pane labels, and agent integrations. Broader TOML configuration is not a TUI settings feature.

The context-menu inventory is:

- Workspace: rename and close.
- Git workspace: rename, close or close group, create worktree, open worktree, expand/collapse group.
- Linked worktree: rename, close, and delete checkout.
- Tab: new tab, rename, and close.
- Pane: rename, optional clear name, optional swap with focused pane, split right/down, zoom, and close.

## Parity matrix

| Surface | TUI capability | Desktop 0.1.0 | Required 0.1.5 result |
| --- | --- | --- | --- |
| Engine ownership | Herdr owns PTYs, session, layouts, agents, persistence | Complete | Preserve; no parallel desktop state authority |
| Terminal attachment | Writable takeover, ANSI frames, input, resize, release | Complete | Preserve and regression-test |
| Terminal scrolling | Public `terminal.scroll` commands | Missing | Wheel and page-key scrolling through Herdr |
| Terminal copy/search | Copy mode, history navigation, search, selection | Partial local selection only | Search bar, next/previous result, copy selection, scroll-to-bottom |
| Terminal links | Modifier-click URLs | Missing | Safe HTTPS link activation through the external URL allowlist |
| Terminal side effects | Graphics, clipboard, notification, window-title client frames | Public adapter drops these frames | Use public alternatives where available; document upstream bridge requirement for irreducible frames |
| Event lifecycle | Subscription to canonical session events | Partial | Surface connected/reconnecting state and recover after end/error |
| Workspaces | Create, focus, rename, close | Complete | Preserve |
| Workspace order | Drag reorder and ordered navigation | Missing | Reorder with `workspace.move`; previous/next and indexed focus |
| Workspace metadata | Agent rollup, tokens, Git/worktree identity | Partial | Render worktree identity and useful metadata tokens |
| Worktree groups | Create/open/remove checkout, group and collapse | Missing | Full worktree dialogs, destructive confirmation, group expansion |
| Tabs | Create, focus, rename, close | Complete | Preserve |
| Tab order/navigation | Drag reorder, previous/next, indexed focus | Missing | Reorder with `tab.move`; native previous/next/index shortcuts |
| Pane layout | Split, focus, zoom, rename, close | Complete core | Preserve |
| Pane navigation | Directional focus, cycle, last pane | Missing | Directional engine focus and deterministic cycle behavior |
| Pane arrangement | Directional swap and swap-with-focused | Missing | Public `pane.swap` controls |
| Pane move | Move to tab/new tab/new workspace | Missing | Graphical move destination workflow using `pane.move` |
| Pane resizing | Resize mode and mouse border drag | Missing | Directional resize plus split-handle ratio updates |
| Pane metadata | Label, cwd, foreground cwd, title, state labels, tokens | Mostly hidden | Pane detail surface and clear-name action |
| Agents | Live detection, status rollups, focus | Partial | Use canonical `snapshot.agents`; show name, readiness, lifecycle, session details |
| Agent ordering | Grouped or attention-priority sidebar | Missing | User-selectable grouped/priority ordering |
| Agent start | Supported agent launcher | Complete core | Add arguments and timeout while preserving validation |
| Agent interaction | Terminal interaction plus public rename/prompt controls | Terminal only | Rename and prompt workflows backed by Herdr |
| Notifications | In-app/terminal/system delivery and target opening | Missing | In-app agent transition notifications and click-to-focus |
| Sidebar | Expanded/collapsed, resizable sections | Fixed | Collapsible workspace/agent regions and responsive presentation |
| Navigator | Hierarchical workspace/tab/pane search and state filters | Missing | Command palette with query and blocked/working/idle/done filters |
| Context menus | Mouse-first workspace/tab/pane actions | Button menus only | Native/right-click access to the same action set |
| Global menu | Settings, keybindings, reload, what's new, detach | Partial native menu | Complete native Session/Workspace/Tab/Pane/Help menus |
| Keybinding help | Searchable active action list | Missing | Searchable shortcuts dialog and menu entry |
| Settings | Six TUI sections | Binary selection only | Appearance, indicators, sound, notifications, pane labels, integrations, plus engine binary |
| Config reload | Reload Herdr configuration | Missing | Public `server.reload_config` action and result feedback |
| Integrations | Detect/install supported agent integrations | Missing | List status and install/uninstall through Herdr |
| Onboarding | Mouse-first introduction and engine startup | Complete engine recovery | Add short interaction/help entry points |
| Release/update UX | Release notes, announcement, update/restart state | Partial | What's New dialog, update/restart-needed banner, engine self-update and desktop update check from the sidebar |
| Responsive/mobile | Mobile header and switcher | Missing; window minimum is 1000px | Compact navigator/switcher and lower safe minimum size |
| Accessibility | Mouse and keyboard first-class | Partial | Keyboard-focusable pane surfaces, live regions, reduced motion |
| Plugins/custom commands | Plugin panes and configured actions | Not represented | Public plugin/action inventory and invocation; preserve engine ownership |
| Persistence | Herdr restores session; UI preferences persist | Engine complete, desktop binary only | Persist only desktop presentation preferences; never copy session state |

## Public API coverage

Desktop 0.1.0 wraps 14 mutations. TUI parity additionally requires these current public methods:

- `workspace.move`, `workspace.move_block`
- `worktree.list`, `worktree.create`, `worktree.open`, `worktree.remove`
- `tab.move`
- `pane.swap`, `pane.move`, `pane.focus_direction`, `pane.resize`
- `layout.set_split_ratio`
- `agent.rename`, `agent.prompt`, `agent.view.set`, `agent.view.clear`
- `integration.install`, `integration.uninstall`
- `server.reload_config`, `server.stop`, `server.live_handoff`
- `server.agent_manifests`, `server.reload_agent_manifests` where detection diagnostics are shown
- `plugin.list`, `plugin.action.list`, `plugin.action.invoke`, and plugin-pane lifecycle for public plugin UI

The following public methods remain automation/reporter primitives rather than TUI parity work: raw pane input/read/wait methods, agent wait/read/send-key automation, metadata reporters, agent authority reporters, layout import/export, graphics producers, and low-level event waits. Desktop features may use them internally when needed, but they are not exposed indiscriminately.

## Upstream public-interface boundaries

Herdr's public `terminal session control` NDJSON accepts input, resize, scroll, and release. It currently emits ANSI terminal frames and close events but discards server Graphics, Clipboard, Notify, and WindowTitle messages. Herdr Desktop will not deserialize Herdr's private bincode client protocol to recover them.

For 0.1.5:

- Scrolling is implemented because it is already public.
- Window titles are derived from canonical focused-pane snapshot metadata.
- Agent notifications are derived from canonical session events/snapshots.
- Text copy uses the graphical terminal selection and the OS clipboard through an explicit user action.
- Retained/plugin graphics use public graphics APIs only where a stable stream is available.
- Irreducible image-clipboard and private client-frame behavior is recorded as requiring an upstream neutral bridge addition; it is not silently reimplemented.
- Chat image paste is implemented on the client side with public APIs only: the desktop stages the clipboard image locally and brackets-pastes the staged path into the pane, mirroring Herdr's own image-paste flow. It never deserializes the private client protocol.

Named-session selection, update/channel changes, remote attach orchestration, and some integration-status commands are CLI-only in the current engine. Where the TUI exposes them, the desktop main process may invoke the current Herdr CLI and must parse finite structured output. It must not persist an alternative representation.

## Development phases

### Phase 1 — contract, architecture, and reliability

Deliverables:

- Split the oversized renderer into bounded workspace, tab, pane, agent, settings, navigator, and shortcut surfaces.
- Expand the typed command contract and validation for every parity API method.
- Add result-returning engine queries for worktrees, integrations, plugins, and diagnostics.
- Add terminal scroll commands.
- Add event subscription connection-state/reconnect behavior.
- Replace pane-derived agent cards with canonical `snapshot.agents`.
- Add tests for every new request mapping, payload boundary, and reconnect transition.

Completion evidence:

- Failing tests observed before production changes.
- All engine and IPC tests green.
- Existing 59 tests remain green.
- Real Herdr snapshot, mutation, terminal scroll, and reconnect smoke scenarios pass.

### Phase 2 — spaces, worktrees, navigation, and ordering

Deliverables:

- Worktree-group rendering with expand/collapse.
- Create/open/remove worktree dialogs and confirmation.
- Workspace and tab reorder controls, with mouse drag where reliable and accessible alternatives everywhere.
- Previous/next/indexed workspace and tab navigation.
- Searchable Navigator covering workspaces, tabs, panes, and agent-state filters.
- Complete workspace/tab context menus.

Completion evidence:

- Component tests cover success, empty, error, destructive-confirmation, filtering, and keyboard navigation.
- Real Herdr worktree lifecycle is tested in a disposable Git repository.
- Reorder operations prove canonical snapshot order after refresh.

### Phase 3 — pane and terminal power tools

Deliverables:

- Directional focus, pane cycling, swap, move, and accessible resize controls.
- Drag split handles backed by `layout.set_split_ratio`.
- Complete pane context menu including clear label and swap.
- Engine-backed wheel/page scrolling.
- Terminal search, copy, link handling, copy feedback, and scroll-to-bottom controls.
- Pane detail metadata for cwd, foreground process context, title, scroll, and agent session.

Completion evidence:

- Unit tests prove command serialization, clamping, direction mapping, terminal scroll messages, and search lifecycle.
- Renderer tests prove keyboard-only and mouse workflows.
- A real two-level split layout survives resize, swap, move, zoom, unzoom, and terminal reconnect.

### Phase 4 — agents, notifications, integrations, and plugins

Deliverables:

- Canonical rich agent cards and grouped/priority sorting.
- Start options, rename, prompt, focus, and session/readiness details.
- In-app lifecycle notifications with click-to-focus.
- Integration list/install/uninstall UI.
- Agent-manifest status/reload diagnostics.
- Public plugin list, action invocation, and plugin-pane lifecycle where the current stable API supports it.

Completion evidence:

- Tests cover all agent lifecycle states, ordering, notification deduplication, payload validation, and failed integrations/actions.
- Real Herdr tests launch and focus an available supported agent only when one is installed; otherwise the engine query and error path are proven.

### Phase 5 — settings, help, native desktop, and responsive parity

Deliverables:

- Settings sections for appearance, indicators, sound, notifications, pane labels, integrations, and engine binary.
- Strict neobrutalism.dev v4 visual system in every new surface.
- Searchable shortcut/help dialog and complete native menus.
- Reload-config, What's New, update/restart banner, onboarding help, and detach semantics.
- Collapsible sidebars, compact responsive switcher, keyboard-focusable panes, live regions, and reduced-motion support.
- Desktop preferences stored locally with schema validation and user-only permissions.

Completion evidence:

- Settings round trips and malformed preference recovery are tested.
- Native menu actions reach the renderer through the finite preload bridge.
- Computer Use verifies desktop and compact layouts, dialogs, shortcuts, and accessibility tree labels.

### Phase 6 — integration audit and 0.1.5 release

Deliverables:

- Re-run this matrix item by item against current upstream `origin/master`.
- Record any upstream-bound public-interface limitations with exact evidence.
- Run full tests, typecheck, lint, current-stable dependency check, runtime audit, packaged smoke, signature checks, and archive integrity checks.
- Exercise the exact packaged application with Computer Use against a real Herdr server.
- Update all product/package metadata to `0.1.5` only after parity gates pass.
- Produce validated macOS DMG and ZIP artifacts.

Completion evidence:

- No matrix row remains accidentally missing or indirectly verified.
- `npm outdated` is empty for stable releases.
- Runtime dependency audit has zero known vulnerabilities.
- DMG and ZIP app bundles pass strict code-signature validation.
- The packaged UI completes the parity walkthrough without using demo mode.

## Test policy

Every behavior change follows red-green-refactor:

1. Add one focused failing test.
2. Run it and confirm the expected failure is the missing behavior.
3. Add the minimum production implementation.
4. Run the focused test and the affected suite.
5. Refactor only while green.

Mocks are limited to the Electron boundary, child process/socket transport, and terminal canvas where real dependencies are impractical. Real pure functions and renderer behavior are preferred. Final parity claims require a real Herdr server and packaged-app walkthrough in addition to unit tests.

## Release decision

Version `0.1.5` is not a planning label. It is the release number earned after Phases 1–6 pass. The version bump must be the final implementation mutation so every generated artifact contains the audited code and metadata.

## Final implementation audit

Phases 1–5 are implemented. The candidate now has a finite validated command/query bridge, canonical reconnect/resynchronization, worktree spaces, ordering, Navigator, graphical pane topology controls, split handles, terminal search/copy/link/scroll tools, canonical agent cards, native and in-app notifications, full settings and manifest diagnostics, public plugin management, native menus, compact switching, persistent presentation preferences, reduced-motion behavior, and restart/handoff guidance.

The remaining differences are explicit upstream public-interface boundaries, not accidental omissions:

- Public terminal control still does not forward Graphics, Clipboard, Notify, or WindowTitle client frames. The desktop uses canonical metadata, explicit copy, engine events, public graphics APIs, and system notifications instead of opening Herdr's private bincode protocol.
- Herdr does not expose built-in integration status as a structured public result. The desktop offers validated install/uninstall/repair actions and labels this limitation instead of guessing installed state.
- Public plugin inventory does not expose action-argument schemas or a managed-plugin-pane inventory. The desktop invokes the published actions without invented arguments and supports pane open/focus/close whenever the engine provides a pane identifier.

Current automated evidence before the release-number mutation:

- TypeScript: passing.
- Biome: passing.
- Vitest: 37 files and 244 tests passing.
- `npm outdated`: empty for stable releases.
- `npm audit --omit=dev --audit-level=moderate`: zero vulnerabilities.
- Packaged-renderer smoke: passing against the macOS arm64 application bundle.
- Real engine: Herdr 0.8.0 stable, protocol 19, connected to a canonical multi-tab, multi-pane snapshot.
