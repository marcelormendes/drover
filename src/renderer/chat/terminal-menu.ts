export interface TerminalMenu {
  readonly options: readonly string[];
  readonly selectedIndex: number;
  readonly position?: string;
}

const MARKER_LINE = /^(\s*)(?:→|❯|›|▸|➤)\s(\S.*)$/;
const EMPTY_MARKER_LINE = /^\s*(?:>|→|❯|›|▸|➤)\s*$/;
const COUNTER_LINE = /^\s*\((\d+)\/(\d+)\)\s*$/;
const BORDER_LINE = /^[\s─━═│╭╮╰╯┌┐└┘|+-]*$/;

interface OptionScan {
  readonly labels: string[];
  readonly position?: string;
}

function scanOptions(lines: string[], start: number, step: 1 | -1, indent: string): OptionScan {
  const labels: string[] = [];
  let position: string | undefined;
  for (let index = start; index >= 0 && index < lines.length; index += step) {
    const line = lines[index];
    const counter = line.match(COUNTER_LINE);
    if (counter) {
      position = `${counter[1]}/${counter[2]}`;
      break;
    }
    if (!line.startsWith(indent) || line.length <= indent.length) {
      break;
    }
    const label = line.slice(indent.length);
    if (label.startsWith(' ') || BORDER_LINE.test(label)) {
      break;
    }
    labels.push(label.trimEnd());
  }
  return { labels, position };
}

// Detects a CLI selection list rendered on the pane screen: one row marked
// with a selection cursor (pi/claude/codex use →, ❯, ›, …) and its aligned
// sibling rows. The marker plus at least one sibling qualifies as a menu.
export function detectTerminalMenu(text: string): TerminalMenu | null {
  const lines = text.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (EMPTY_MARKER_LINE.test(lines[index])) {
      // An empty composer prompt is newer than anything above it. Older
      // wrapped prompts can resemble a selected option plus sibling rows.
      return null;
    }
    const marker = lines[index].match(MARKER_LINE);
    if (!marker) {
      continue;
    }
    const [, markerIndent, markerLabel] = marker;
    const optionIndent = `${markerIndent}  `;
    const above = scanOptions(lines, index - 1, -1, optionIndent);
    const below = scanOptions(lines, index + 1, 1, optionIndent);
    const options = [...above.labels.reverse(), markerLabel.trimEnd(), ...below.labels];
    if (options.length < 2) {
      // The newest prompt is the active CLI state. Do not scan backward and
      // revive an old wrapped prompt as though it were still an open menu.
      return null;
    }
    return {
      options,
      selectedIndex: above.labels.length,
      position: below.position ?? above.position,
    };
  }
  return null;
}

export function menuSelectionKeys(menu: TerminalMenu, targetIndex: number): string[] {
  const delta = targetIndex - menu.selectedIndex;
  const moves = delta >= 0 ? Array<string>(delta).fill('down') : Array<string>(-delta).fill('up');
  return [...moves, 'enter'];
}
