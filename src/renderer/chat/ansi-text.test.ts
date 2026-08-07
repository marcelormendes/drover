import { describe, expect, it } from 'vitest';

import {
  parseAnsiLines,
  responseThinkingLines,
  stripAnsi,
  thinkingLineCounts,
  thinkingLineSet,
} from '@/renderer/chat/ansi-text';

const ESC = '\x1b';
// Captured from a live pi pane: thinking = italic + truecolor gray 128.
const piSample = [
  ` ${ESC}[0m${ESC}[3m${ESC}[38;2;128;128;128mAlso worth checking quickly: does the upstream Herdr work?${ESC}[0m`,
  '',
  ` ${ESC}[0m${ESC}[3m${ESC}[38;2;128;128;128mLet me structure the answer:${ESC}[0m`,
  ` ${ESC}[0m${ESC}[1mHonest caveats${ESC}[0m (documented in the audit):`,
  ' Short answer: yes — plugins work.',
  ` ${ESC}[0m${ESC}[38;2;138;190;183mplugin.action.invoke${ESC}[0m runs actions.`,
].join('\r\n');

describe('ansi-text', () => {
  it('strips every escape sequence and carriage return', () => {
    expect(stripAnsi(piSample)).toContain('Also worth checking quickly');
    expect(stripAnsi(piSample)).not.toContain('\x1b');
    expect(stripAnsi(piSample)).not.toContain('\r');
  });

  it('classifies gray italic lines as thinking and normal lines as answer', () => {
    const lines = parseAnsiLines(piSample);

    expect(lines[0]).toEqual({
      text: ' Also worth checking quickly: does the upstream Herdr work?',
      thinking: true,
    });
    expect(lines[2].thinking).toBe(true);
    expect(lines[3].thinking).toBe(false);
    expect(lines[4].thinking).toBe(false);
    expect(lines[5].thinking).toBe(false);
  });

  it('treats dim text and bright-black text as thinking too', () => {
    const dim = parseAnsiLines(`${ESC}[2mquiet reasoning${ESC}[0m\nplain answer`);
    expect(dim[0].thinking).toBe(true);
    expect(dim[1].thinking).toBe(false);

    const gray = parseAnsiLines(`${ESC}[90mmuted line${ESC}[0m`);
    expect(gray[0].thinking).toBe(true);
  });

  it('never marks colored or plain output as thinking', () => {
    const lines = parseAnsiLines(
      [`${ESC}[38;2;138;190;183mteal token`, `${ESC}[0mplain`, `${ESC}[1mbold`].join('\n'),
    );
    expect(lines.map((line) => line.thinking)).toEqual([false, false, false]);
  });

  it('collects trimmed thinking lines for lookups', () => {
    const set = thinkingLineSet(piSample);
    expect(set.has('Also worth checking quickly: does the upstream Herdr work?')).toBe(true);
    expect(set.has('Short answer: yes — plugins work.')).toBe(false);
  });
});

describe('response thinking scoping', () => {
  it('counts muted occurrences per line', () => {
    const raw = [
      `${ESC}[38;2;128;128;128mSame note.${ESC}[0m`,
      `${ESC}[38;2;128;128;128mSame note.${ESC}[0m`,
      `${ESC}[38;2;128;128;128mOther note.${ESC}[0m`,
      'Answer text.',
    ].join('\n');
    expect(thinkingLineCounts(raw)).toEqual(
      new Map([
        ['Same note.', 2],
        ['Other note.', 1],
      ]),
    );
  });

  it('scopes muted lines to the active response, excluding older history', () => {
    const raw = [
      `${ESC}[38;2;128;128;128mOlder turn note.${ESC}[0m`,
      'ready',
      'Fix the layout',
      `${ESC}[38;2;128;128;128mCurrent thinking.${ESC}[0m`,
      '- Final answer.',
    ].join('\n');
    const response = 'Current thinking.\n- Final answer.';
    expect(responseThinkingLines(raw, response)).toEqual(['Current thinking.']);
  });
});
