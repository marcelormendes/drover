export type ReplySegment =
  | { readonly kind: 'text'; readonly text: string; readonly tone?: 'thinking' }
  | { readonly kind: 'pre'; readonly text: string; readonly tone?: 'thinking' };

export type ThinkingLines = ReadonlySet<string> | ReadonlyMap<string, number> | readonly string[];

function isCountMap(value: ThinkingLines): value is ReadonlyMap<string, number> {
  return (
    typeof (value as ReadonlyMap<string, number>).get === 'function' &&
    typeof (value as ReadonlySet<string>).has !== 'function'
  );
}

/** Normalizes any thinking-lines shape to per-line occurrence counts. */
export function thinkingCounts(
  thinkingLines: ThinkingLines | undefined,
): ReadonlyMap<string, number> | undefined {
  if (!thinkingLines) {
    return undefined;
  }
  if (Array.isArray(thinkingLines)) {
    const counts = new Map<string, number>();
    for (const line of thinkingLines) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    return counts;
  }
  if (isCountMap(thinkingLines)) {
    return thinkingLines;
  }
  return new Map([...thinkingLines].map((line) => [line, 1]));
}

/** Occurrence-aware muted score for a set of source lines. */
function mutedScore(sourceLines: string[], counts: ReadonlyMap<string, number>): number {
  const meaningful = sourceLines.filter((line) => line !== '');
  if (meaningful.length === 0) {
    return 0;
  }
  const remaining = new Map(counts);
  let muted = 0;
  for (const line of meaningful) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      muted += 1;
      remaining.set(line, count - 1);
    }
  }
  return muted / meaningful.length;
}

// Agent CLIs print the model's self-talk before the answer with no machine
// marker left after ANSI stripping, so recognize the way that voice opens.
const THINKING_OPENER =
  /^(?:the user\b|the conversation\b|i should\b|i need\b|i'?ll\b|i will\b|i want to\b|i think\b|i'?m going to\b|let me (?!know)|looking at\b|checking\b|this is likely\b|they (?:want|asked|demand)\b|we (?:need|should|have to)\b|need exact\b|maybe i\b|actually,|okay,|ok,|hmm\b|wait,)/i;
const SPINNER_LINE = /^[⠁-⣿]?\s*(?:working|thinking|baking)(?:\.{3}|…)/i;

function textTone(text: string): 'thinking' | undefined {
  return THINKING_OPENER.test(text) || SPINNER_LINE.test(text) ? 'thinking' : undefined;
}

const BOX_CHARS = /[┌┐└┘├┤┬┴┼│─━═╭╮╰╯║╔╗╚╝]/;
const RULE_LINE = /^[\s─━═_*=-]{6,}$/;
const LIST_MARKER = /^(?:[-*•·▪‣]|\d+[.)]|[a-z][.)])\s+\S/;
const ALIGNED_COLUMNS = /\S {2,}\S.* {2,}\S/;

function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length);
  const shared = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(shared));
}

// Tables, boxes, and code keep their exact spacing; everything else is prose
// the CLI hard-wrapped to the terminal width and should reflow to the panel.
function isPreformatted(lines: string[]): boolean {
  const boxLines = lines.filter((line) => BOX_CHARS.test(line)).length;
  if (boxLines >= 2) {
    return true;
  }
  if (lines.some((line) => line.trimStart().startsWith('```'))) {
    return true;
  }
  const columnLines = lines.filter((line) => ALIGNED_COLUMNS.test(line)).length;
  return lines.length >= 2 && columnLines >= 2;
}

function reflow(lines: string[], thinkingLines?: ThinkingLines): ReplySegment[] {
  const segments: ReplySegment[] = [];
  let current = '';
  let sourceLines: string[] = [];
  const flush = () => {
    const text = current.trim();
    if (text) {
      segments.push({ kind: 'text', text, tone: paragraphTone(text, sourceLines, thinkingLines) });
    }
    current = '';
    sourceLines = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    // An indented run under a bullet is that bullet's continuation, so only a
    // fresh marker (or a heading line ending in a colon) breaks the paragraph.
    if (LIST_MARKER.test(trimmed) || current.endsWith(':')) {
      flush();
      current = trimmed;
      sourceLines = [trimmed];
      continue;
    }
    current = current ? `${current} ${trimmed}` : trimmed;
    sourceLines.push(trimmed);
  }
  flush();
  return segments;
}

// The CLI's own colors decide when available; the phrasing heuristic covers
// runtimes whose output carries no color information.
function paragraphTone(
  text: string,
  sourceLines: string[],
  thinkingLines?: ThinkingLines,
): 'thinking' | undefined {
  const counts = thinkingCounts(thinkingLines);
  if (counts && counts.size > 0) {
    return mutedScore(sourceLines, counts) >= 0.5 ? 'thinking' : undefined;
  }
  return textTone(text);
}

function blockTone(lines: string[], thinkingLines?: ThinkingLines): 'thinking' | undefined {
  const counts = thinkingCounts(thinkingLines);
  if (counts && counts.size > 0 && mutedScore(lines, counts) >= 0.5) {
    return 'thinking';
  }
  return undefined;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// CLIs echo the submitted prompt into their own output; once reflowed it is a
// duplicate of the user's bubble directly above it.
export function stripEchoedPrompt(segments: ReplySegment[], prompt?: string): ReplySegment[] {
  const wanted = prompt ? normalize(prompt) : '';
  if (!wanted) {
    return segments;
  }
  const first = segments[0];
  if (first?.kind === 'text' && normalize(first.text) === wanted) {
    return segments.slice(1);
  }
  return segments;
}

export interface FormatOptions {
  readonly thinkingLines?: ThinkingLines;
}

export function formatAgentReply(text: string, options?: FormatOptions): ReplySegment[] {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd());
  const segments: ReplySegment[] = [];
  let block: string[] = [];
  const flushBlock = () => {
    if (block.length === 0) {
      return;
    }
    const body = dedent(block);
    if (isPreformatted(body)) {
      segments.push({
        kind: 'pre',
        text: body.join('\n'),
        tone: blockTone(body, options?.thinkingLines),
      });
    } else {
      segments.push(...reflow(body, options?.thinkingLines));
    }
    block = [];
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flushBlock();
      continue;
    }
    if (RULE_LINE.test(line)) {
      // Terminal separator rules carry no meaning once the text is reflowed.
      flushBlock();
      continue;
    }
    block.push(line);
  }
  flushBlock();
  return segments;
}
