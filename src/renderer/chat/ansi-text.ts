export interface AnsiLine {
  readonly text: string;
  readonly thinking: boolean;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequences are control characters by definition
const ANSI_SEQUENCE = /\x1b(?:\[[0-9;?]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

export function stripAnsi(raw: string): string {
  return raw.replace(ANSI_SEQUENCE, '').replace(/\r/g, '');
}

interface SgrState {
  dim: boolean;
  fg: { r: number; g: number; b: number } | 'gray-basic' | null;
}

// Agent CLIs render the model's thinking in a muted gray (pi uses italic
// 38;2;128;128;128); the answer keeps the default foreground. A neutral
// mid-gray foreground or an explicit dim flag marks a character as muted.
function isMuted(state: SgrState): boolean {
  if (state.dim || state.fg === 'gray-basic') {
    return true;
  }
  if (state.fg && typeof state.fg === 'object') {
    const { r, g, b } = state.fg;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const level = (r + g + b) / 3;
    return spread <= 16 && level >= 88 && level <= 176;
  }
  return false;
}

function grayLevelFrom256(code: number): { r: number; g: number; b: number } | null {
  if (code >= 232 && code <= 255) {
    const level = 8 + (code - 232) * 10;
    return { r: level, g: level, b: level };
  }
  return null;
}

function applySgr(params: number[], state: SgrState): void {
  for (let index = 0; index < params.length; index += 1) {
    const code = params[index];
    if (code === 0) {
      state.dim = false;
      state.fg = null;
    } else if (code === 2) {
      state.dim = true;
    } else if (code === 22) {
      state.dim = false;
    } else if (code === 39) {
      state.fg = null;
    } else if (code === 90) {
      state.fg = 'gray-basic';
    } else if ((code >= 30 && code <= 37) || (code >= 91 && code <= 97)) {
      state.fg = null;
    } else if (code === 38) {
      const mode = params[index + 1];
      if (mode === 2) {
        state.fg = {
          r: params[index + 2] ?? 0,
          g: params[index + 3] ?? 0,
          b: params[index + 4] ?? 0,
        };
        index += 4;
      } else if (mode === 5) {
        state.fg = grayLevelFrom256(params[index + 2] ?? 0);
        index += 2;
      }
    }
  }
}

export function parseAnsiLines(raw: string): AnsiLine[] {
  const state: SgrState = { dim: false, fg: null };
  const lines: AnsiLine[] = [];
  let text = '';
  let visible = 0;
  let muted = 0;

  const endLine = () => {
    lines.push({ text: text.trimEnd(), thinking: visible > 0 && muted / visible >= 0.8 });
    text = '';
    visible = 0;
    muted = 0;
  };

  let cursor = 0;
  ANSI_SEQUENCE.lastIndex = 0;
  let match = ANSI_SEQUENCE.exec(raw);
  while (cursor < raw.length) {
    const nextStop = match ? match.index : raw.length;
    while (cursor < nextStop) {
      const char = raw[cursor];
      cursor += 1;
      if (char === '\n') {
        endLine();
      } else if (char !== '\r') {
        text += char;
        if (char !== ' ' && char !== '\t') {
          visible += 1;
          if (isMuted(state)) {
            muted += 1;
          }
        }
      }
    }
    if (match) {
      const sequence = match[0];
      if (sequence.endsWith('m') && sequence.startsWith('\x1b[')) {
        const body = sequence.slice(2, -1);
        applySgr(
          body.split(';').map((part) => Number.parseInt(part || '0', 10)),
          state,
        );
      }
      cursor = match.index + sequence.length;
      match = ANSI_SEQUENCE.exec(raw);
    }
  }
  endLine();
  return lines;
}

// Trimmed text of every muted line, for matching against reflowed reply text.
export function thinkingLineSet(raw: string): ReadonlySet<string> {
  const set = new Set<string>();
  for (const line of parseAnsiLines(raw)) {
    if (line.thinking && line.text.trim()) {
      set.add(line.text.trim());
    }
  }
  return set;
}

/**
 * Occurrence counts of muted lines, preserving multiplicity so a line that
 * appears in both the thinking block and the answer is not overcounted.
 */
export function thinkingLineCounts(raw: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const line of parseAnsiLines(raw)) {
    const text = line.text.trim();
    if (line.thinking && text) {
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }
  return counts;
}

function plainLines(text: string): Set<string> {
  const lines = new Set<string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) {
      lines.add(trimmed);
    }
  }
  return lines;
}

/**
 * Muted lines (with multiplicity) that belong to the active response text.
 * The pane snapshot also contains older turns and terminal chrome; only lines
 * present in the extracted response can color that response's paragraphs.
 */
export function responseThinkingLines(raw: string, responseText: string): string[] {
  const counts = thinkingLineCounts(raw);
  if (counts.size === 0) {
    return [];
  }
  const wanted = plainLines(responseText);
  const lines: string[] = [];
  for (const [line, count] of counts) {
    if (wanted.has(line)) {
      for (let index = 0; index < count; index += 1) {
        lines.push(line);
      }
    }
  }
  return lines;
}
