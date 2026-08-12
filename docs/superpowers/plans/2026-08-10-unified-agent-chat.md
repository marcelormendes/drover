# Unified Agent Chat Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-10-unified-agent-chat-design.md`
**Repositories:** Herdr engine and Drover
**Execution:** TDD, no commits, no pushes, no PR, no merge, no release

## Working boundaries

- Preserve all pre-existing Desktop changes, including the unrelated edit in `src/renderer/chat/terminal-menu.test.ts` and the root `lessons.md` file.
- Keep the git-librarian cache at `/home/marcelorm/.cache/checkouts/github.com/herdrdev/herdr` read-only and clean.
- Implement engine work in `/home/marcelorm/workspace/herdr-unified-chat-engine`, a plain source copy prepared from the cache without `.git`. Compare it to the cache with `diff -ruN --exclude target` for review.
- Do not install binaries globally or modify live provider transcript files. Use fixtures and temporary directories.
- Do not add a dependency unless the standard library and current dependencies cannot meet the contract.

## Phase 1: Freeze the public contract with failing engine tests

### Files

- Engine: `src/api/schema/conversations.rs` (new)
- Engine: `src/api/schema.rs`
- Engine: `src/api/schema/agents.rs`
- Engine: `src/api/schema/panes.rs`
- Engine: `src/api/schema/response.rs`
- Engine: `src/api/schema/events.rs`
- Engine: `src/api/schema/server.rs`
- Engine: `src/api/schema/tests.rs`
- Engine: `docs/next/api/herdr-api.schema.json`

### Tests first

1. Add schema serialization tests for `agent.conversation.read`:
   - no cursor means newest/tail page;
   - `older` plus cursor pages backward;
   - `newer` plus cursor returns deltas;
   - limit is bounded and invalid cursor/direction combinations are rejected.
2. Add response tests for ordered canonical items, opaque cursors, `has_older`, conversation revision, and session reset identity.
3. Add schema tests for pane/agent conversation availability: `supported`, `unavailable`, `unsupported`, with stable reason codes.
4. Add a pane-scoped `agent.conversation_changed` subscription/event schema test.
5. Add a backward-compatible global `agent_conversations` server capability. Missing capability must decode as false.
6. Add provider-neutral approval response and chunked attachment upload DTO tests, keeping every chunk below the existing request-line cap.
7. Add a separate optional opaque conversation-session identity; path-backed sessions omit the legacy optional `agent_session` field rather than adding a new `kind`. Prove no capable-engine pane, agent, conversation, or event response serializes a transcript path.
8. Feed a capable-engine snapshot through the current released Desktop snapshot decoder and prove old Desktop still boots Terminal while ignoring the new optional identity.

### Implementation

- Put canonical DTOs in their own schema module rather than expanding `agents.rs` into a catch-all.
- Keep transcript paths private: no response or event field may serialize a path.
- Use one tagged canonical item enum with common stable ID/order/session/turn metadata and bounded typed payloads.
- Keep the conversation API additive and do not bump Herdr's terminal wire `PROTOCOL_VERSION`; the old-engine Terminal fallback depends on exact protocol compatibility. Regenerate the JSON API schema artifact.

### Gate

- New schema tests pass.
- Existing schema snapshot tests pass.
- A serialized conversation response contains no fixture transcript path.

## Phase 2: Track transcript sources separately from resume references

### Files

- Engine: `src/agent_resume.rs`
- Engine: `src/terminal/state.rs`
- Engine: `src/app/api/panes.rs`
- Engine: `src/app/api.rs`
- Engine: persistence/restore files only if transcript ownership must survive a server restart
- Engine: `src/integration/assets/codex/herdr-agent-state.sh`
- Engine: `src/integration/assets/claude/herdr-agent-state.sh`
- Engine: Pi/OMP integration assets only where their reporting contract needs adjustment
- Engine: `tests/cli/hooks.rs`
- Engine: existing terminal-state and integration tests

### Tests first

1. Prove a Claude or Codex report can retain both a resume ID and a transcript path.
2. Prove Pi/OMP path resume behavior remains unchanged.
3. Prove session replacement/reset replaces the matching transcript reference atomically.
4. Prove a stale or conflicting provider report cannot attach a transcript to another pane/session owner.
5. Prove public `AgentSessionInfo` still exposes only the correct resume reference and never the transcript path when the resume reference is an ID.
6. Update Codex hook tests to assert its existing `transcript_path` input is reported.
7. Prove capable-engine public agent/session data omits legacy path-backed `agent_session`, adds a separate opaque identity, and internal restore still uses the real path.
8. Prove missing, invalid, stale, and cross-pane integration tokens cannot attach a transcript or publish live activity.

### Implementation

- Introduce a separate internal transcript reference owned by terminal/pane state. Do not extend the resume-reference enum to carry two meanings.
- Generate an unguessable per-pane integration token, inject it into the managed process, bind it to pane/provider/process generation, require it for transcript and live-conversation reports, and rotate it on managed process replacement.
- Derive resume and transcript references from the same accepted lifecycle report, so existing source/sequence/foreground authority rules govern both.
- Clear or replace the transcript reference wherever the accepted provider session is cleared or replaced.
- Preserve the transcript reference across persistence only if the corresponding accepted provider session is persisted and validation is repeated on restore.
- Omit the optional public `agent_session` for path-backed refs and add a separate optional opaque conversation-session identity. Do not add a new legacy `kind` value. Keep real resume paths internal and test both compatibility directions: new Desktop with old engine, and released Desktop decoder with capable engine.

### Gate

- Existing agent resume/session authority tests remain green.
- New dual-reference and lifecycle tests pass.

## Phase 3: Build the bounded conversation reader and provider adapters

### Files

- Engine: `src/agent_conversation.rs` (public module boundary)
- Engine: `src/agent_conversation/jsonl.rs`
- Engine: `src/agent_conversation/pi.rs`
- Engine: `src/agent_conversation/omp.rs`
- Engine: `src/agent_conversation/codex.rs`
- Engine: `src/agent_conversation/claude.rs`
- Engine: `src/agent_conversation/fixtures/*.jsonl` (small, synthetic/redacted)
- Engine: module-local tests

### Tests first

Create minimal native fixtures based on verified provider shapes. Cover:

- visible user and assistant text;
- commentary versus final response;
- raw `thinking`, Codex reasoning, and reasoning summaries excluded from visible messages;
- tool start/result pairing with one stable item ID;
- running/completed/failed tool state;
- plan/todo normalization;
- file change summaries with bounded path lists;
- completion, interruption, and safe error state;
- duplicate records and rereads;
- partially written final JSONL record;
- malformed complete line;
- source truncation/replacement;
- initial tail page, older page, and newer delta larger than the old Desktop snapshot limit;
- stable IDs/order/cursors across rereads;
- reader generation/reset behavior across engine restart, cache eviction, concurrent older/newer reads, and an unchanged provider session;
- maximum native bytes scanned, maximum returned items, maximum serialized text/detail, and maximum paths.

### Implementation

- Use a small provider adapter trait consumed by the conversation reader. Adapters return canonical items; they do not know about Desktop presentation.
- Make public cursors represent canonical conversation position: direction, engine/reader generation, opaque session identity, source fingerprint, and canonical sequence/revision. Keep transcript byte offsets private to durable adapters. Responses are chronological even when the durable reader scans backward from EOF for the initial tail. Stale generation/session/source cursors return `reset_required`.
- Derive stable IDs from provider-native IDs when available and from session identity plus record byte offset/block index otherwise. Never derive identity from mutable display text.
- Cache only validated source identity and incremental reader state. Never cache unbounded native payloads.
- Treat an incomplete final line as pending. Skip and count malformed complete records without blocking later records.
- On inode/identity change or file shrink, invalidate cursors and return a reset.
- Keep Pi and OMP adapters separate but share proven-identical JSONL/content helpers.
- Add authenticated, bounded, coalesced Pi/OMP lifecycle ingestion for message updates, tool start/update/end, plans, approvals, and turn state because their transcripts persist many records only at message completion. Reconcile ephemeral items with durable records by stable provider identity.
- Test more than one full page of live overlay events while JSONL length is unchanged, then durable reconciliation, with no omitted or duplicate canonical items.
- Do not expose raw provider records. Allowlist display fields and cap them before constructing DTOs.

### Path validation

- Canonicalize the transcript and provider root.
- Require a regular JSONL file below the expected provider data roots (`.pi`, `.omp`, `.codex`, `.claude`, including their supported configurable roots).
- Reject relative paths, traversal, wrong-provider roots, device files, and symlink escapes.
- Revalidate file identity on every reopen/reset.
- Test allowed default/custom roots and every rejection case with temporary directories.

### Gate

- All four adapter suites pass.
- No fixture raw reasoning or transcript path appears in serialized output.
- A page/delta can span more than 500 native lines without loss or duplication.

## Phase 4: Wire reads, availability, and live change subscription into Herdr

### Files

- Engine: `src/app/api/agents.rs`
- Engine: `src/app/api.rs`
- Engine: `src/api/subscriptions.rs`
- Engine: `src/api/server.rs`
- Engine: `src/api/event_hub.rs` only if the existing hub is the correct seam
- Engine: API integration tests under `tests/`

### Tests first

1. `agent.conversation.read` resolves the accepted target pane and its engine-local transcript source.
2. Unsupported, no-session, missing-file, invalid-source, and temporarily unreadable cases return stable availability/reason codes rather than raw I/O errors.
3. Initial, older, and newer reads obey cursors, revision, reset, item, and byte bounds.
4. A subscription sends one `agent.conversation_changed` notification when source identity/length changes, without embedding items.
5. Unchanged files do not reparse or emit.
6. Monitoring stops on disconnect and is limited to explicit subscribers.
7. Remote-style API clients receive the same JSON contract without filesystem access.
8. Authenticated live lifecycle reports produce immediate conversation changes and reconcile without duplication when durable JSONL arrives.
9. Engine restart or reader-cache generation change makes old cursors explicitly reset even when the provider session and file are unchanged.
10. `agent.conversation.respond` verifies pane/session/generation/request ownership, accepts only advertised decisions, is idempotent for the same result, and rejects stale/conflicting/resolved requests.

### Implementation

- Add one App/API handler delegating to the conversation service.
- Populate pane/agent availability from the accepted agent identity plus validated transcript reference.
- Add an active conversation subscription variant. Its poll path performs a cheap source metadata probe; payload parsing remains in `agent.conversation.read`.
- Accept bounded live lifecycle reports only with the pane's integration token and feed them through the same provider adapter/canonical store.
- Delegate approval responses through explicit provider adapter mappings. If an adapter cannot safely respond, publish the approval as read-only so Desktop opens Terminal instead of guessing input.
- Reuse the existing connection poll lifecycle and error response conventions.
- Return safe reason codes; keep OS paths and detailed I/O diagnostics in local logs only.

### Gate

- Targeted API and subscription tests pass.
- Generated schema is current.
- `cargo fmt --check`, `cargo check`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test` pass in the engine working copy.

## Phase 5: Add the typed Desktop bridge and reducer

### Files

- Desktop: `src/shared/herdr.ts`
- Desktop: `src/shared/desktop-api.ts`
- Desktop: `src/shared/events.ts`
- Desktop: `src/main/herdr/engine.ts`
- Desktop: `src/main/herdr/query-decoder.ts`
- Desktop: `src/main/herdr/event-subscription.ts`
- Desktop: corresponding tests
- Desktop: `src/renderer/chat/conversation-model.ts` (new)
- Desktop: `src/renderer/chat/conversation-model.test.ts` (new)

### Tests first

1. Strict decoding accepts every canonical item and rejects malformed/unbounded shapes.
2. Missing `agent_conversations` capability decodes as false for older engines.
3. Query mapping covers tail/older/newer reads.
4. Event decoding covers conversation change/reset and ignores unrelated panes.
5. Reducer handles initial page, older prepend, newer append/update, stable ordering, duplicates, session reset, stale response, and reconnect.
6. Optimistic user messages reconcile once and preserve a failed/syncing state when appropriate.
7. A synthetic delta over 500 records remains complete and never invokes `pane.read`.
8. A changed reader generation always resets before applying a lower or otherwise incomparable revision.
9. Legacy path-kind session data is discarded from renderer conversation state.

### Implementation

- Define canonical shared types once in `desktop-api.ts`/`herdr.ts`; do not duplicate provider-specific unions in renderer code.
- Add strict size-aware decoders in main.
- Extend the existing Herdr query mapping; do not add a second transport.
- Subscribe only for panes whose Chat timeline is active. Reconnect by rereading from the last cursor/revision and honor reset.
- Keep projection pure: canonical events in, stable turn view-model out.

### Gate

- Main/shared/reducer tests pass.
- Remote engine code remains unchanged unless a test proves the generic API tunnel cannot carry the new method/event.

## Phase 6: Replace the Chat timeline with Herdr-native T3-like behavior

### Files

- Desktop: `src/renderer/chat/ChatPanel.tsx`
- Desktop: split focused components such as `ChatTimeline.tsx`, `TurnWorkSummary.tsx`, and `ToolActivityRow.tsx` if `ChatPanel.tsx` would become unwieldy
- Desktop: existing/new chat component tests
- Desktop: `src/renderer/App.tsx`
- Desktop: `src/index.css` only for reusable token-backed utilities that existing classes cannot express

### Tests first

1. Active turn shows a self-updating `Working for …` duration and active plan step.
2. Commentary and tool activity preserve chronological order.
3. Repetitive tools group behind `+N tool calls` without losing accessible content.
4. Completed/interrupted/failed work folds to the correct summary while final answer remains visible.
5. Changed files render as a bounded summary.
6. Tool details are keyboard accessible and status is expressed as text.
7. Scroll follows only near the bottom or immediately after local submission; loading older history preserves the viewport anchor.
8. Supported, unavailable, unsupported, and old-engine Chat controls have the correct disabled state and tooltip.
9. Terminal mode remains selectable and unaffected.
10. Pending approvals render allowed provider decisions, submit by stable request ID, and handle idempotent/resolved/stale responses; approvals without a safe responder show `Open Terminal to respond`.

### Implementation

- Reuse existing Herdr `Button`, `ScrollArea`, `Tooltip`, surfaces, borders, shadows, status colors, typography, and spacing.
- Use native `<details>/<summary>` styled with Herdr tokens unless an existing disclosure primitive is more appropriate; do not introduce another UI dependency.
- Keep the final assistant answer visually primary. Fold only intermediate commentary/work for settled turns.
- Batch incoming canonical deltas and preserve stable React keys.
- Respect reduced motion and avoid whole-list streaming animations.
- Never infer an approval decision or terminal key from display text. Use only engine-advertised decision IDs; use the explicit Terminal fallback otherwise.

### Gate

- Component accessibility/interaction tests pass.
- Responsive layouts remain usable at the existing tested breakpoints.
- Visual inspection confirms Herdr neobrutalism, not T3 styling.

## Phase 7: Remove the lossy supported-Chat path

### Files

- Desktop: `src/renderer/App.tsx`
- Desktop: `src/renderer/chat/ChatPanel.tsx`
- Desktop: `src/renderer/chat/transcript-model.ts` and tests
- Desktop: `src/renderer/chat/ansi-text.ts` / `reply-format.ts` only if no remaining consumer needs them

### Tests first

- Add an integration regression asserting that selecting Chat for Pi, OMP, Codex, or Claude performs conversation reads and never calls the pane-output query.
- Assert unsupported/old-engine panes cannot enter Chat and therefore cannot activate snapshot fallback.
- Keep Terminal pane-read and terminal-menu tests green.

### Implementation

- Delete the Chat polling, 500-line baseline, prompt/overlap reconstruction, rollover reconciliation, and Chat-only ANSI-thinking extraction once no consumer remains.
- Do not retain a hidden fallback. A temporarily unavailable structured transcript displays an honest unavailable/stale state.
- Preserve unrelated slash-command and prompt/input behavior. Terminal menu selection remains Terminal-only; structured Chat approvals use the new response contract.

### Gate

- No supported Chat code path imports or calls `extractPaneResponse`, `applyPaneRead`, or `pane.read`.
- Dead parser code/tests are removed only after confirming no non-Chat consumer.

## Phase 8: Move image attachments to engine-owned staging

### Files

- Engine: conversation/attachment schema, service, API handlers, cleanup, and integration tests
- Desktop: `src/main/chat-images.ts` or its replacement
- Desktop: `src/shared/desktop-api.ts`
- Desktop: `src/main/herdr/engine.ts`
- Desktop: `src/renderer/chat/ChatPanel.tsx`
- Desktop: corresponding tests

### Tests first

1. Begin validates pane/session ownership, media type, name, declared size, digest, and quotas.
2. Ordered base64 chunks stay below Herdr's request-line limit and reject reordering, duplication conflicts, overflow, and cross-pane handles.
3. Finish verifies exact size/digest, stores 0600 files in a 0700 engine-owned temporary directory, and returns an opaque handle rather than a path.
4. Prompt resolves only same-pane/session handles and stages provider-visible paths entirely on the engine host.
5. Abort, failed prompt, completed prompt, session replacement, disconnect timeout, and TTL cleanup remove files.
6. Local and remote integration tests use the same tunnel/API flow and never reference a Desktop-local path on the engine host.

### Implementation

- Add `agent.attachment.begin`, bounded ordered chunk upload, finish, and abort operations.
- Extend `agent.prompt` with optional attachment handles. Resolve handles and perform the existing provider paste/input behavior inside the engine host.
- Replace Desktop-local path staging for structured Chat. Retain old staging only for a proven non-structured local consumer; otherwise remove it.
- Keep raw bytes and engine paths out of conversation events and renderer state.

### Gate

- A maximum-size allowed attachment succeeds through chunking without exceeding request-line bounds.
- All cleanup, ownership, and remote tests pass.

## Phase 9: Verification and review loop

### Automated verification

Engine working copy:

```bash
cargo fmt --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Desktop:

```bash
npm run typecheck
npm run lint
npm test
npm run site:build
git diff --check
```

### Behavioral verification

1. Build/run the engine working copy without installing it globally and point Desktop's existing engine preference/test harness to that binary.
2. Verify Pi, OMP, Codex, and Claude sessions started from Chat and from Terminal.
3. Re-run a fast, tool-heavy OMP turn equivalent to the live frozen case and prove the final answer arrives.
4. Verify interruption, failed tool, image prompt, long history pagination, user scroll anchoring, provider session reset/resume, and engine reconnect.
5. Verify through the remote-engine tunnel or its real integration harness.
6. Verify an unsupported provider and an older engine show disabled Chat plus working Terminal.
7. Verify a Pi/OMP turn shows tool activity before `message_end`, then reconciles to durable history without duplicate rows.
8. Verify an engine restart during the same provider session forces a clean reader-generation reset.
9. Verify structured and read-only approval flows, including reconnect and stale decisions.

### Review loop

- OMP reports exact changed files, tests, and remaining risks without committing.
- Root agent performs a code review across both trees and runs independent targeted tests.
- Every actionable finding goes back to OMP with a concrete failing case.
- Repeat implementation and review until no finding at 80% or greater confidence remains and all required gates are green.
- Stop before any commit, push, PR, merge, release, installation, or external publication.
