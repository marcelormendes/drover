# Herdr 0.9.0 fork compatibility

The Drover fork integrates official Herdr v0.9.0 while retaining the structured
conversation API proposed in [upstream discussion 2677](https://github.com/herdrdev/herdr/discussions/2677).
Official v0.9.0 does not provide that conversation layer. Drover still needs the
fork for provider transcripts, tools, approvals, attachments and conversation events.

## Preserved contracts

- Structured conversation readers for Claude, Codex, Pi and OMP, including source
  identity, privacy boundaries, persisted metadata and live handoff.
- Headless agent readiness and attachment cleanup, adapted to upstream's split
  server implementation and asynchronous prompt submission.
- Retained-history search, cursor validation and atomic match reveal, using the
  upstream bounded search implementation; terminal wheel batching is retained.
- Fork release destinations and assets. Upstream's frozen endpoint codecs and
  generation-1 fixtures remain unchanged. The same-install private protocol is 22.

Herdr 0.9.0 event subscriptions deliver live events. Drover now reports an event
connection as connected only after the matching subscription acknowledgement.
The existing renderer snapshot refresh then covers changes between initial load
and subscription registration, including reconnects and conversation resubscriptions.

## Verification

On macOS, with isolated configuration, state, sockets, workspaces and desktop data:

- Engine `just check`: 3,226 Rust tests passed, two skipped, plus maintenance
  checks. Native and Windows-target Clippy passed with warnings denied.
- Desktop `npm run verify`: 726 tests passed, six skipped, plus type, lint and
  site checks. Packaged renderer smoke passed.
- Live retained terminal search: 2,600 rows, first/next/previous/wrap, Unicode and
  wrapped text, missing matches, stale cursor rejection, rendered match reveal,
  controller takeover and subsequent input passed.
- Live handoff from the published fork v0.8.8 to this candidate preserved the
  child PID, existing output and subsequent input, with no hangup.
- Pi and OMP returned real shell tool output, exact final assistant replies and
  completed turns through `agent.conversation.read`. OMP used the candidate's
  extension explicitly, without replacing the global installation.
- Codex passed the same structured conversation checks using a dedicated
  app-server launched with the pane environment.

## Limits and rollout

The ordinary Codex TUI reused an existing shared app-server without Herdr pane
environment variables, leaving its conversation unavailable. The isolated
app-server demonstrates the preserved fork integration, but does not resolve
that shared-server setup. No existing user daemon was restarted.

Desktop accessibility calls timed out, so visible UI acceptance is unverified.
Claude integration fixtures passed; live Claude authentication was not verified.
Windows compilation/lint checks are not Windows runtime acceptance.

The desktop engine pin remains the published fork v0.8.8. A subsequent fork
release, verified assets and a separate pin update are needed to ship this sync.
The official v0.9.0 tag must not be pushed as a fork release: it lacks the Drover
changes. This compatibility change is based on desktop release/v0.1.32, whose
metadata PR #51 still awaits review into main.
