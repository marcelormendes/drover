# Unified Agent Chat Design

**Date:** 2026-08-10
**Status:** Approved after three independent review passes

## Summary

Drover will provide one provider-neutral Chat experience for Pi, OMP, Codex, and Claude. The interaction and information hierarchy follow the useful parts of T3 Code's chat timeline, while all presentation remains native to Drover's existing neobrutalist component library and design tokens.

The Herdr engine, not the Desktop renderer, will own provider transcript discovery and normalization. Desktop will request a canonical conversation page and subscribe to conversation changes through the existing Herdr JSON API. Terminal mode remains the exact PTY view. Providers without a structured adapter keep Terminal access, while their Chat option is visibly disabled with a tooltip explaining that Chat is not currently supported.

This removes the root cause of the recurring frozen-chat bug: a bounded terminal snapshot cannot be used as a lossless conversation log.

## Problem and root cause

The current Chat implementation polls a 500-line `recent_unwrapped` pane snapshot and reconstructs a reply by searching for the submitted prompt or overlap with the previous snapshot. Its rollover reconciliation only searches a small tail window. With fast full-screen TUIs such as OMP, a redraw can move the prompt and all usable overlap outside both windows between reads. When that happens during a working turn, the parser deliberately retains the previous reply and can remain frozen even though the pane revision and live terminal output continue to advance.

This behavior was reproduced on the live Omarchy workspace: the OMP terminal reached a completed answer while Desktop Chat remained at an older working frame. Increasing the snapshot size, polling faster, or widening the overlap search only changes how often the failure occurs. None makes rolling terminal frames a durable event source.

For supported providers, the structured Chat path must not call `pane.read` or infer messages, reasoning, tools, or completion from ANSI output. `pane.read` remains valid only for Terminal mode and other terminal-oriented features.

## Reference behavior from T3 Code

T3 Code provides the behavioral reference, not the visual design or application architecture. The relevant behaviors are:

- A working turn shows an elapsed `Working for …` indicator and the current plan step when available.
- Assistant commentary can appear between compact work rows.
- Tool activity is summarized into stable, compact rows with status, a useful label, and bounded expandable detail.
- Repetitive tool rows may be grouped, with overflow represented as an explicit count.
- After completion or interruption, intermediate work folds into a compact `Worked for …` or `Stopped after …` summary.
- The final assistant response remains directly visible.
- Changed-file information is attached to the completed turn.
- Stable item identity, scroll anchoring, and deliberate follow-output behavior avoid visual jumps.
- Raw provider chain-of-thought is not rendered.

Herdr will recreate those behaviors with its own components, borders, colors, spacing, typography, motion, and interaction patterns.

## Goals

1. Give Pi, OMP, Codex, and Claude the same coherent Chat presentation.
2. Show the full provider session, including turns initiated in the underlying terminal.
3. Represent assistant text, work/tool activity, plans, changed files, interruptions, approvals, and errors without exposing raw chain-of-thought.
4. Work identically through local and remote Herdr engines.
5. Eliminate terminal-snapshot reconstruction from supported Chat providers.
6. Keep long sessions responsive through bounded pages, bounded detail, incremental updates, and stable rendering.
7. Degrade honestly when a provider is unsupported or its transcript is temporarily unavailable.

## Non-goals

- Rebuilding T3 Code's wider application, source-control workflow, navigation, settings, or visual system.
- Rendering raw reasoning or hidden model chain-of-thought.
- Inventing a universal provider command protocol. Prompts continue through Herdr's existing agent/terminal input path.
- Providing structured Chat for arbitrary TUIs in the first release.
- Replacing Terminal mode.
- Synchronizing or copying raw transcript files to Desktop.

## Architecture and ownership

```text
Provider transcript or structured hook
        |
        v
Herdr provider adapter -> canonical conversation model -> Herdr JSON API/events
                                                        |
                                         local socket or remote tunnel
                                                        |
                                                        v
Desktop main bridge -> renderer conversation store -> Herdr chat timeline
```

### Herdr engine responsibilities

- Track transcript location separately from the provider's resume identity. A resume ID and a transcript path are different facts and must not be overloaded into a single value.
- Resolve transcript sources on the machine where Herdr runs. Remote filesystem paths never cross into Desktop for direct access.
- Authenticate managed integration reports with a per-pane capability token before accepting transcript or live conversation data.
- Parse provider-native records with a dedicated Pi, OMP, Codex, or Claude adapter.
- Reconcile durable transcript history with bounded live lifecycle events emitted by providers that do not persist partial activity.
- Normalize records into the canonical contract below.
- Apply security and size bounds before values leave the engine.
- Serve paged history and signal incremental changes through the public JSON API.
- Report structured-chat capability and current availability for each pane.
- Keep transcript parsing out of terminal render, agent-detection, and other hot paths. Work is on demand for active readers/subscribers and cached by transcript identity plus file position.

### Desktop main responsibilities

- Add typed bridge methods for conversation capability, paged reads, and change subscriptions.
- Reuse the active Herdr API connection, including the existing remote-engine tunnel.
- Validate and bound API responses before forwarding them to the renderer.
- Avoid provider-specific transcript parsing or filesystem access.

### Desktop renderer responsibilities

- Keep a normalized per-pane conversation store keyed by provider session identity.
- Merge history pages and incremental refreshes idempotently by stable item ID and sequence.
- Project canonical items into turns and T3-like work summaries.
- Preserve user scroll position; follow output only when the user is already near the bottom or has just submitted a prompt.
- Render with existing Herdr components and tokens only.

## Transcript identity

Herdr already receives useful session information from its integrations. Pi and OMP can report an absolute transcript path. Claude reports both a session ID and transcript path. Codex's session hook already receives `transcript_path`, but currently reports only the session ID.

The implementation will retain two internal facts:

- **Resume reference:** the provider value used to resume a session.
- **Transcript reference:** the local engine-side source used to read structured conversation records.

Only sanitized conversation data and opaque session identity are exposed to Desktop. Transcript paths are not part of the public conversation response.

The current public `AgentSessionInfo` exposes Pi/OMP path resume references. The capable engine retains the real resume reference internally but omits the already-optional legacy `agent_session` field for path-backed sessions. It adds a separate optional opaque conversation-session identity that old Desktop versions ignore and new Desktop uses. Existing `AgentSessionInfo.kind` values are not changed, so the current released Desktop decoder can still load a capable-engine snapshot and run Terminal. Provider-ID session information may remain in the legacy field when it is already a safe opaque value. New Desktop decoding accepts the legacy path shape only from old engines for Terminal compatibility and does not put it into the renderer conversation model. Schema tests must prove capable-engine pane, agent, conversation, and event responses contain no transcript path, and a compatibility test must feed a capable-engine snapshot through the released Desktop decoder.

Provider hooks must report a transcript path when the provider supplies one, but the shared user socket is not itself a pane authenticator. Herdr generates an unguessable per-pane integration token, injects it only into that managed pane process, and requires it on transcript-source and live-conversation reports. The token is bound to the pane, accepted provider authority, and process generation, and rotates when the managed pane process is replaced. Existing source/sequence/session authority rules still govern session changes inside that process. Invalid, missing, stale, or cross-pane tokens cannot attach a transcript or publish conversation items.

After authentication, paths must be absolute/canonicalized and match the reporting provider's supported default or configured data roots. Symlink escape, replacement, truncation, and rotation are rejected or handled as explicit source resets rather than allowing arbitrary file reads.

## Public JSON API contract

Names remain provider-neutral and follow the existing dot-separated JSON API style.

### Capability

Agent/pane information exposes a structured-chat state:

- `supported`: an adapter exists and a transcript source is available.
- `unavailable`: the provider is supported, but no valid session/transcript is currently available.
- `unsupported`: no structured adapter exists.

The state includes a machine-readable reason code and may include a short safe message. Desktop maps reason codes to user-facing copy instead of displaying raw engine errors.

### Read

`agent.conversation.read` accepts a pane target, an optional opaque page cursor, and a bounded page size. It returns:

- provider and opaque session identity;
- current capability/availability;
- ordered canonical items;
- next/previous cursor as applicable;
- whether more history exists;
- a revision monotonic only within the returned reader generation;
- a reader generation/reset identity derived from the engine instance, provider session, source fingerprint, and reader-cache generation.

The first read returns the most recent bounded window so Chat opens quickly. Older history is requested when the user scrolls upward. Refresh reads request records after the last known cursor/revision. Public cursors describe canonical conversation position: direction, reader generation, opaque session identity, source fingerprint, and canonical sequence/revision. Transcript byte offsets remain private durable-adapter state and are never the public position, because live Pi/OMP overlay events can advance without file growth. A cursor from another engine generation, session, replaced source, or evicted incompatible reader state returns an explicit `reset_required` result with the current generation; it is never silently reused.

### Subscription

`events.subscribe` gains a pane-scoped `agent.conversation_changed` subscription. Its event carries only pane identity, opaque session identity, reader generation, the new conversation revision, and whether the client must reset. It does not duplicate transcript payloads. Desktop responds by reading the delta through `agent.conversation.read`.

The subscription monitors only explicitly subscribed conversations. A lightweight metadata poll is acceptable when a portable filesystem notification is unavailable, but it must avoid parsing unchanged files and use the existing connection lifecycle so it stops immediately on unsubscribe/disconnect.

### Compatibility

This is an additive JSON API capability. The generated JSON API schema is updated, but Herdr's exact-match terminal wire `PROTOCOL_VERSION` is not incremented because no existing terminal wire value changes. This is required for a new Desktop to bootstrap against an older otherwise-compatible engine. Desktop feature-detects the default-false `agent_conversations` server capability. With an older Herdr engine, Terminal continues to work and Chat is disabled with an `Update Herdr to use Chat` tooltip; it must not query the missing method or silently fall back to snapshot parsing.

## Canonical conversation model

Every item has:

- a deterministic `id` stable across rereads;
- a monotonically ordered `sequence` within the opaque session identity;
- `provider`, `session_id`, and `turn_id` where known;
- a timestamp when the provider supplies one;
- a typed payload.

Canonical item types:

1. `user_message`
   - Text and attachment metadata safe for display.
   - Provider-native image contents or arbitrary local paths are not returned.

2. `assistant_message`
   - `phase`: `commentary` or `final`.
   - Renderable text and completion/interruption state.
   - Raw reasoning records never map to this item merely because they contain text.

3. `plan_update`
   - Ordered steps with pending, active, completed, or failed status.

4. `tool_activity`
   - Normalized action, concise label, status (`running`, `completed`, `failed`), bounded preview/detail, duration when known, and affected paths when safe.
   - Provider payloads, command environments, secrets, oversized outputs, and unbounded diffs are not exposed.

5. `file_change`
   - Path, change kind, and bounded summary/statistics. Content/diff detail is optional and capped.

6. `approval`
   - Stable request ID, safe prompt, explicit allowed decisions, pending/resolved state, selected decision when known, and whether structured response is supported.

7. `turn_state`
   - Started, completed, interrupted, or failed plus timing and safe error summary.

8. `notice`
   - A bounded, provider-neutral warning for skipped/unknown/corrupt records when useful to the user.

Unknown native records are ignored and counted for diagnostics. They must not crash a page or force an invented presentation. Partially written final JSONL records are retained for the next read. A malformed complete record is skipped with bounded diagnostics, not retried forever.

## Provider adapters

Each adapter implements one internal interface: validate source, open/reset source, read a bounded page/delta, normalize durable records, normalize authenticated live lifecycle records, reconcile the two by stable identity, and expose a stable session identity.

### Pi and OMP

Pi and OMP use closely related message-oriented JSONL. Their adapters normalize:

- user and assistant messages;
- assistant `text` as commentary/final according to message/turn completion;
- `toolCall` plus matching `toolResult` as a single stable tool activity;
- plan/todo tools into `plan_update` when structurally recognizable;
- toolResult file paths or edit operations into bounded file-change summaries;
- `thinking` as work timing/status metadata only, never raw visible reasoning.

Pi and OMP persist many user, assistant, and tool-result records only at message completion, so transcript polling alone cannot power the promised live work timeline. Their managed integrations also publish authenticated, size-bounded, coalesced runtime lifecycle records for message updates, tool start/update/end, plan changes, approvals, and turn state when exposed by the provider SDK. The engine owns their normalization and holds them as an ephemeral overlay. When the durable JSONL record arrives, stable provider message/tool/request IDs reconcile and replace the overlay without duplication. If an integration cannot obtain a native stable ID, Herdr issues a turn-scoped ID and passes it back through the managed reporting context.

The adapters share parsing helpers only where the native record contracts are actually identical; provider-specific interpretation remains separate.

### Codex

The Codex adapter consumes rollout JSONL response items and events. It normalizes visible assistant messages, plan updates, tool/custom-tool calls and outputs, file changes, interruptions, and turn completion. Reasoning and reasoning summaries are not shown as assistant text. The managed session hook is updated to retain the supplied transcript path separately from the Codex thread/resume ID.

### Claude

The Claude adapter consumes the main-session JSONL and excludes subagent transcripts unless they are represented as bounded tool activity in the root session. It pairs `tool_use` and `tool_result`, normalizes visible messages and edits, and ignores raw `thinking`. The managed hook's transcript path is retained separately from its session/resume ID.

## Turn projection and presentation

Desktop groups canonical items by turn and renders:

### Active turn

- A compact neobrutalist `Working for 12s` row using existing status tokens.
- The active plan step, if present.
- Visible assistant commentary in chronological position.
- Stable compact work rows for tools/edits with an icon, label, status, and optional disclosure.
- Repeated low-value activities grouped after a small visible limit with a `+N tool calls` disclosure.

### Settled turn

- Intermediate activity collapsed by default into `Worked for 18s`, `Stopped after 18s`, or `Failed after 18s`.
- Expanding the summary reveals the chronological commentary/work rows.
- The final assistant response remains visible outside the collapsed work group.
- A changed-files summary is attached below the response when applicable.

### Visual constraints

- Use Herdr's existing `Button`, `ScrollArea`, tooltip, disclosure/collapsible, border, surface, status, typography, and color primitives.
- Keep the current heavy borders, flat shadows, compact geometry, and design-token colors.
- Do not import T3 styling, copy its theme, add a second design system, or use raw one-off colors when a Herdr token exists.
- Motion is limited and respects reduced-motion preferences. Streaming updates must not animate the entire timeline.
- Work detail is keyboard accessible and exposes status through text, not color alone.

## Chat availability UX

- `supported`: Chat is enabled.
- `unavailable`: Chat is disabled and gray; hover/focus tooltip explains the safe reason, such as `Start or resume this agent to use Chat`.
- `unsupported`: Chat is disabled and gray; tooltip says `Chat is not currently supported for this provider. Use Terminal instead.`
- old engine/no capability: Chat is disabled and gray; tooltip says `Update Herdr to use structured Chat.`

The Terminal/Chat switch must be a real disabled control with accessible description, not a clickable option that fails after navigation.

## Prompting and optimistic state

Submitting from Chat continues to use the existing Herdr prompt/input mechanism so provider behavior does not diverge between Terminal and Chat. The renderer may show an optimistic user message identified by a client submission ID. When the provider transcript emits the durable user item, the store reconciles it without duplication using submission metadata where available and conservative text/time matching otherwise.

If prompt delivery fails, the optimistic item is marked failed and remains retryable. If delivery succeeds but transcript ingestion is delayed, the UI shows a syncing state and performs a bounded reread. It never fabricates an assistant reply from terminal output.

### Approval responses

`agent.conversation.respond` accepts the pane target, reader generation, opaque session identity, stable approval request ID, and one advertised decision ID. The engine verifies that the request is still pending and belongs to the authenticated active provider session, then delegates to the provider adapter's explicit response mapping. Duplicate delivery of the same decision is idempotent; conflicting, stale, resolved, or unknown requests fail safely and trigger a reread. When a provider exposes an approval but no safe structured responder, the item is read-only and Chat shows `Open Terminal to respond` rather than guessing terminal keys.

### Local and remote attachments

Desktop-local staging is insufficient for a remote engine because its absolute paths do not exist on the engine host, and Herdr's JSON request-line cap cannot carry a complete large image. Attachments therefore use an engine-owned bounded upload protocol over the existing API tunnel:

1. `agent.attachment.begin` binds an upload to a pane/session, declared media type, file name, byte size, and digest, and returns an opaque upload handle.
2. Ordered base64 chunks remain comfortably below the request-line limit and are capped individually and in aggregate.
3. `agent.attachment.finish` verifies size/digest and returns an attachment handle, not a host path.
4. `agent.prompt` accepts those handles; the engine resolves them to 0600 temporary files on its own host, injects provider-visible paths through the existing input behavior, and then sends the prompt.
5. Abort, prompt completion/failure, session replacement, disconnect timeout, and TTL cleanup remove staged data. Per-pane, per-file, and aggregate quotas prevent resource exhaustion.

Local and remote Desktop use this same path. Conversation responses expose only safe attachment metadata; bytes and engine-host paths are never placed in conversation events.

## Session changes, truncation, and recovery

- A new provider session identity atomically resets the pane's conversation store.
- A new engine instance or incompatible reader-cache generation changes the reader generation even when the provider session/file is unchanged.
- A source that shrinks, rotates, changes inode/identity, or becomes invalid emits `reset` and is reopened only after revalidation.
- Duplicate notifications and rereads are harmless because item IDs are stable and merges are idempotent.
- Out-of-order items are sorted by canonical sequence; impossible conflicting IDs trigger a reset/diagnostic rather than corrupting the timeline.
- A temporary read error keeps the last complete timeline visible with a non-blocking stale/error indicator and bounded retry.
- On local/remote reconnect, Desktop presents its last complete timeline while rereading from its cursor only if reader generation, session, and source fingerprint still match; otherwise it atomically resets to the new tail.

## Performance and resource bounds

- Initial and history pages have strict item and serialized-byte limits.
- Text, tool previews, details, path lists, and diagnostic counts are individually capped.
- The engine caches provider reader state by validated transcript identity and last byte/record position.
- Unchanged sources are not reparsed.
- Only connected conversation subscribers are watched.
- Desktop virtualizes or otherwise bounds rendering for long sessions while preserving accessible reading order.
- Renderer updates are batched per API delta rather than per text token.

## Security and privacy

- Transcript files are read only by the Herdr engine on the machine that owns them.
- Transcript source paths are not sent to Desktop.
- Managed transcript and live-lifecycle reports require an unguessable per-pane integration token and are constrained to its pane, provider authority, and process generation. Socket permissions remain defense in depth, not the authenticator.
- Paths are canonicalized and validated against provider roots/session ownership before reading.
- Tool inputs/outputs are projected through explicit allowlists and byte bounds. Environment variables, credentials, hidden reasoning, raw model payloads, and arbitrary file contents are excluded.
- Unknown record types fail closed: ignore and diagnose rather than display raw JSON.
- Remote mode uses the existing Herdr API tunnel, including chunked attachment staging on the engine host; no Desktop-side SSH file access or broad filesystem grant is introduced.

## Testing strategy

### Herdr engine

- Fixture tests for Pi, OMP, Codex, and Claude with redacted native JSONL covering user text, assistant commentary/final, thinking exclusion, tool pairing, edits, plans, errors, interruptions, partial records, malformed records, truncation, rotation, and session replacement.
- Contract tests for deterministic IDs/order, pagination, byte/item bounds, path redaction, unknown-record behavior, capability reasons, and idempotent deltas.
- Hook tests proving resume identity and transcript reference are both retained without exposing the path publicly.
- Authentication tests for missing/invalid/stale/cross-pane tokens, provider mismatch, process replacement, session authority, and symlink replacement.
- Durable/live reconciliation tests proving Pi/OMP activity streams before message completion and does not duplicate once JSONL catches up.
- Subscription tests proving changes are signaled only for active subscribers and stop on disconnect.
- Reader-generation tests covering engine restart with the same provider session, concurrent history/delta requests, cache eviction, truncation, and file replacement.
- Attachment begin/chunk/finish/abort, quotas, digest, ownership, cleanup, and remote-tunnel integration tests.
- Approval ownership, allowed-decision, idempotency, reconnect, stale-request, and provider-response mapping tests.
- Schema snapshot tests plus a compatibility test proving the additive API does not change the terminal wire protocol.

### Desktop

- Reducer tests for history paging, deltas, resets, duplicate notifications, optimistic reconciliation, remote reconnect, and stale/read-error behavior.
- Component tests for active/settled turn projection, commentary ordering, grouped tool rows, changed files, failures, accessible disclosures, and scroll-follow rules.
- Capability tests for supported, temporarily unavailable, unsupported, and old-engine disabled Chat tooltips.
- A regression test proving supported Chat never calls `pane.read`, including a transcript delta larger than the old 500-line/32-line-overlap limits.
- Existing Terminal-mode tests remain green.
- Approval tests cover structured decisions and the read-only `Open Terminal to respond` fallback.
- Attachment tests prove local and remote modes both use opaque engine upload handles rather than Desktop-local paths.

### End-to-end verification

- Exercise live Pi, OMP, Codex, and Claude sessions with turns initiated from both Chat and Terminal.
- Verify a fast OMP tool-heavy turn that previously froze.
- Verify local engine, remote engine, reconnect, session reset/resume, long history paging, interruption, failed tool, image prompt, and user-scroll preservation.
- Verify older Herdr and unsupported providers show disabled Chat and retain working Terminal mode.

## Rollout

The additive engine API/capability ships before or together with the Desktop consumer without changing the exact-match terminal wire protocol. Desktop gates the new Chat path on the advertised capability. There is no snapshot-parser fallback for supported Chat. The old parser can be removed once no remaining UI path depends on it; Terminal continues to use pane snapshots directly.

No PR, merge, release, dependency publication, or external write is part of this implementation pass. Those require separate explicit authorization.
