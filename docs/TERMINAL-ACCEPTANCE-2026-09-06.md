# Terminal acceptance — September 6, 2026

Tested the local desktop changes in native Electron with a separate Herdr config,
state directory, socket, and named session. The installed Drover and its active
engine were not replaced. These results apply to the local development build,
not the currently installed release.

## Bugs reproduced and fixed

- Cmd+V followed immediately by Enter submitted the old prompt before clipboard
  IPC completed. Clipboard reads, paste delivery, and subsequent input now keep
  their order, with pending work discarded when the terminal unmounts.
- Multiline paste executed the first line before Enter. Herdr owns the real PTY's
  bracketed-paste mode, so clipboard text now uses its public `pane.send_input`
  path instead of inferring the mode from xterm's viewport frames.
- Tiny trackpad events each scrolled at least one line. Fractional motion now
  accumulates across frames. Wheel events include pointer cells and modifiers;
  modified PageUp/PageDown are left to xterm's keyboard encoding.
- Full-screen applications received one wheel event regardless of requested line
  count. The companion engine fix repeats the encoded events in one input batch.
- The WebGL layer intercepted clicks on Reconnect/search overlays. The xterm
  mount now has its own stacking context, keeping those controls clickable.

## Live evidence

| Flow | Result |
| --- | --- |
| Select output, Cmd+C, paste into another pane | Exact COPY_PASTE_OK text copied and echoed |
| Cmd+V immediately followed by Enter | Complete command submitted; COPY_PASTE_OK output |
| Multiline Unicode paste | Both lines remained editable before Enter; BRACKET_ONE and BRACKET_TWO with café, Japanese, and emoji appeared once afterward |
| Shell wheel and PageUp scrolling | Reached older numbered output and returned to live prompt |
| Full-screen pager | PageDown worked; two-page wheel gesture advanced from line 1 to line 36 after fix |
| Mouse-aware terminal program | Received 22 wheel-down reports at column 47/row 21; next gesture reported wheel-up at column 8/row 10 |
| Ctrl+C | Interrupted sleep and restored shell prompt |
| Tab switch | Terminal output preserved after visiting Pi Chat and returning |
| Split resizing | Output wrapped to resized panes without corruption |
| Reconnect after isolated server restart | Mouse click restored attachment; RECONNECT_OK command succeeded |
| Search keyboard and mouse controls | Search opened, matched visible text, next/close buttons worked, terminal focus restored |

## Validation and limits

Desktop `npm run verify`: 702 passed, 6 skipped; typecheck, lint, and site build
passed. Packaged macOS arm64 renderer loaded successfully. The final stacking
adjustment also passed all 35 TerminalPanel tests and native click verification.
Engine: 17 terminal-attachment tests passed serially, clippy/formatting passed,
and the debug build used for the live wheel retest succeeded. An initial parallel
engine test run encountered a listener address collision; the serial run passed.

At the time of this QA pass, search covered only the visible renderer buffer.
That limitation was subsequently addressed by the companion engine search API;
see [terminal history search verification](TERMINAL-HISTORY-SEARCH-2026-09-06.md).
No claim is made for every terminal application, OS, image clipboard format,
native IME, or a measured rendering speedup.
