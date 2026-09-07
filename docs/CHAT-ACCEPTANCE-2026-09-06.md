# Chat acceptance — 2026-09-06

Status: implemented and verified locally; Claude response acceptance remains blocked by account authentication. These changes are not released.

## Desktop behavior

- Supported providers open in Chat, including launches with native arguments.
- Codex launches with a configuration override so its hooks inherit the current Herdr pane environment instead of reusing an unrelated app-server.
- Pre-conversation trust and sign-in interactions appear inside Chat through one persistent live terminal surface. Users answer the provider directly; no choices are inferred or sent automatically.
- An idle provider's current visible login prompt can reveal setup. Transcript discovery takes precedence over a stale pane capability and returns to normal Chat.
- Drafts can be edited while launching; sending remains blocked until startup completes.

## Live computer-use results

| Provider | Verified behavior | Result |
| --- | --- | --- |
| Codex | Fresh GUI launch, automatic transcript registration, two turns, tab history, trust prompt answered inside Chat, expanded command source and result | Passed |
| Pi | Fresh GUI launch, lazy first-transcript discovery, two turns, tab history, expanded shell command and result | Passed |
| OMP | Fresh GUI launch, two turns, one final reply, settled working state, expanded shell command and result | Passed with repaired integration |
| Claude | Workspace trust answered inside Chat, automatic transition to composer, expired-login message and sign-in flow visible inside Chat | Setup passed; model response blocked by expired login |

Claude's browser authorization page required a subscribed account. A sign-in request is pending with the user; no subscription was purchased and no default account was changed.

The initial provider checks used disposable QA panes on the existing server. Final command/output checks ran against a separate named engine session with isolated config, state, and sockets. That isolated session was stopped afterward. The user's running engine was not stopped, replaced, or handed off. After QA, the development app was stopped and the installed Drover process was restored. Computer Use timed out during the final restored-window inspection, so that last window state was not visually verified.

## Engine dependency

The companion Herdr fix is local commit `e29ed31a9f44b2df88583ba9f42c913da374316c` on `fix/chat-provider-payload-lifecycle` in `marcelormendes/herdr`:

- Preserve bounded visible tool output for Codex, Pi, and OMP; preserve Codex custom-tool input.
- Ignore OMP assistant callbacks that arrive after completion or belong to an older turn, preventing duplicate replies and an orphaned working state.

The live isolated checks used this commit. Drover still pins released engine 0.8.7; distributing these engine fixes requires a new engine release and updating the pin/checksums. The local OMP extension was repaired with an original-file backup for the fresh-session test.

## Verification

- Drover: `npm run verify` — 659 passed, 6 skipped; typecheck, lint, and site build passed.
- Drover: `npm run test:package` — packaged renderer loaded successfully on macOS arm64.
- Herdr: final conversation parser suite — 62 passed.
- Herdr: broader checks — 3,330 Rust unit tests passed / 1 ignored, 101 runtime integration tests, 34 integration asset tests, 104 maintenance tests, and 31 marketplace tests passed; native and Windows clippy and formatting passed.
- One initial desktop test raced a deferred terminal mount; its assertion now awaits the terminal and the complete verification passes.

Live acceptance markers included `CODEX_ISOLATED_OK`, `PI_ISOLATED_OK`, and `OMP_ISOLATED_OK`, with their respective `*_PAYLOAD_OK` results visible in expanded Chat tool details. These checks establish the tested paths, not a guarantee for every provider configuration or future CLI version.
