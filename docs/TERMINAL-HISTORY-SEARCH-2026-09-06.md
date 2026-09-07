# Terminal history search — September 6, 2026

Cmd/Ctrl+F now searches the terminal history retained by Herdr. A match outside
the current viewport is revealed automatically. The search panel shows the
selected match's index, total count, and text context. Enter/Shift+Enter and the
next/previous buttons navigate matches and wrap at either end.

## Implementation

The desktop uses the new public `pane.search` JSON API. The engine reuses its
literal, case-insensitive, Unicode-aware retained-text search, including matches
across soft line wraps. It validates the selected text and reveals it under the
terminal lock. The API checks the terminal identity, bounds query/cursor sizes,
and returns an opaque cursor rather than copying the entire history to Drover.

The renderer debounces typing and serializes search requests because they move
the viewport. Superseded queries and results are discarded; closing search or
replacing the terminal cancels pending work. An older engine gets an actionable
update message. The terminal's projected frame buffer no longer supplies search
results or independently changes the viewport.

## Verification

Native Electron testing used a separate Herdr configuration, state directory,
socket, and named session. The installed Drover and its active engine were not
replaced.

- Generated 2,600 lines with matching text on lines 12, 1,312, and 2,592.
- From the live bottom, searching lowercase `archive_needle` found all three
  uppercase occurrences and revealed line 12 without manual scrolling.
- Next revealed line 1,312; navigation wrapped between the first and last match
  with the correct count and selected context.
- `WRAP_NEEDLE` matched a phrase split across two physical terminal rows. The
  context retained the adjacent wide and combining Unicode characters.
- An absent query displayed “No matches.”

Desktop: `npm run verify` passed with 725 tests and 6 skips, including typecheck,
lint, and site build. The packaged macOS arm64 renderer loaded successfully.
Engine: 9 search API tests, 38 schema tests, and 7 native search tests passed,
covering old history, wrapping, Unicode, changed output, resizing, identity
guards, and actual history eviction. An independent review found no blocking
desktop lifecycle or API validation issue.

## Boundaries

Search covers retained terminal history, not output already evicted by the
engine or cleared by the application. It rescans on navigation; a cursor is a
best-effort anchor when identical occurrences are evicted and replaced. Returned
matches are validated against current text. The selected context appears in the
search panel; no stale renderer-side highlight is inferred from cached frames.

Both the desktop changes and the companion engine API remain local until a
release includes them.
