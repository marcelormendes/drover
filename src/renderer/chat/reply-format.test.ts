import { describe, expect, it } from 'vitest';

import { formatAgentReply, stripEchoedPrompt } from '@/renderer/chat/reply-format';

// Captured from a live pi agent pane (`herdr pane read`), including the
// terminal-width line breaks the chat panel used to re-wrap a second time.
const piReply = [
  'Short answer: yes — Herdr plugins work in Herdr Desktop, because the desktop deliberately never executes plugin code itself. Plugins run',
  'inside the Herdr engine (the headless server), and the desktop just drives them through the socket API.',
  '',
  'Let me structure the answer:',
  '',
  '- Short answer: Yes, Herdr plugins work in Herdr Desktop — with the caveat that they run inside the',
  '  Herdr engine, not the app.',
  '- What works (list with the API methods).',
  '',
  '┌──────────────────────────┬──────────────────┐',
  '│ Feature                  │ Engine method    │',
  '├──────────────────────────┼──────────────────┤',
  '│ Enable / disable         │ plugin.enable    │',
  '└──────────────────────────┴──────────────────┘',
  '',
  '────────────────────────────────────',
  '',
  'All of this is proxied through the typed IPC bridge.',
].join('\n');

describe('formatAgentReply', () => {
  it('reflows terminal-wrapped prose into one paragraph', () => {
    const [first] = formatAgentReply(piReply);

    expect(first).toEqual({
      kind: 'text',
      text: 'Short answer: yes — Herdr plugins work in Herdr Desktop, because the desktop deliberately never executes plugin code itself. Plugins run inside the Herdr engine (the headless server), and the desktop just drives them through the socket API.',
    });
  });

  it('keeps list items separate and joins their wrapped continuation', () => {
    const items = formatAgentReply(piReply).filter(
      (segment) => segment.kind === 'text' && segment.text.startsWith('-'),
    );

    expect(items).toEqual([
      {
        kind: 'text',
        text: '- Short answer: Yes, Herdr plugins work in Herdr Desktop — with the caveat that they run inside the Herdr engine, not the app.',
      },
      { kind: 'text', text: '- What works (list with the API methods).' },
    ]);
  });

  it('preserves box-drawn tables exactly', () => {
    const pre = formatAgentReply(piReply).filter((segment) => segment.kind === 'pre');

    expect(pre).toHaveLength(1);
    expect(pre[0].text.split('\n')).toHaveLength(5);
    expect(pre[0].text).toContain('│ Feature                  │ Engine method    │');
  });

  it('drops decorative separator rules', () => {
    expect(formatAgentReply(piReply).some((segment) => /^[─-]+$/.test(segment.text))).toBe(false);
  });

  it('keeps aligned column output and indented code as preformatted', () => {
    const table = formatAgentReply(
      ['NAME      STATUS    AGE', 'api       running   3d', 'web       stopped   1h'].join('\n'),
    );
    expect(table).toEqual([
      {
        kind: 'pre',
        text: 'NAME      STATUS    AGE\napi       running   3d\nweb       stopped   1h',
      },
    ]);

    const code = formatAgentReply(['```ts', 'const a = 1;', '```'].join('\n'));
    expect(code[0].kind).toBe('pre');
  });

  it('drops the prompt the CLI echoed back, even when it was wrapped', () => {
    const prompt = 'Answer with one short paragraph, then a table of CLI tools.';
    const segments = formatAgentReply(
      ['Answer with one short paragraph, then a table of', 'CLI tools.', '', 'Here it is.'].join(
        '\n',
      ),
    );

    expect(stripEchoedPrompt(segments, prompt)).toEqual([{ kind: 'text', text: 'Here it is.' }]);
    expect(stripEchoedPrompt(segments, 'something else')).toHaveLength(2);
    expect(stripEchoedPrompt(segments, undefined)).toHaveLength(2);
  });

  it('prefers the CLI color signal over phrasing when thinking lines are known', () => {
    const text = [
      'Considering the layout options for this change.',
      '',
      'Use the flat sidebar variant.',
    ].join('\n');
    const thinkingLines = new Set(['Considering the layout options for this change.']);

    const segments = formatAgentReply(text, { thinkingLines });

    expect(segments).toEqual([
      {
        kind: 'text',
        text: 'Considering the layout options for this change.',
        tone: 'thinking',
      },
      { kind: 'text', text: 'Use the flat sidebar variant.', tone: undefined },
    ]);
  });

  it('marks model self-talk and spinners as thinking, answers stay normal', () => {
    const segments = formatAgentReply(
      [
        'The user wants me to reply with exactly "herd check ok" and nothing else.',
        '',
        '⠏ Working...',
        '',
        'herd check ok',
        '',
        'Let me know if you need anything else.',
      ].join('\n'),
    );

    expect(segments.map((segment) => ('tone' in segment ? segment.tone : undefined))).toEqual([
      'thinking',
      'thinking',
      undefined,
      undefined,
    ]);
  });

  it('returns nothing for empty or whitespace-only output', () => {
    expect(formatAgentReply('')).toEqual([]);
    expect(formatAgentReply('\n   \n')).toEqual([]);
  });
});

describe('formatAgentReply thinking edge cases', () => {
  it('marks preformatted thinking blocks with a thinking tone', () => {
    const segments = formatAgentReply('```sh\necho inspect\n```\n\nFinal answer.', {
      thinkingLines: new Set(['```sh', 'echo inspect', '```']),
    });
    expect(segments[0]).toMatchObject({ kind: 'pre', tone: 'thinking' });
    expect(segments[1]).toMatchObject({ kind: 'text', text: 'Final answer.' });
  });

  it('keeps preformatted answer blocks without a thinking tone', () => {
    const segments = formatAgentReply('```sh\necho inspect\n```\n\nFinal answer.', {
      thinkingLines: new Set(['Unrelated muted line.']),
    });
    expect(segments[0]).toMatchObject({ kind: 'pre', tone: undefined });
  });

  it('classifies by occurrence so a duplicated answer line is not thinking', () => {
    // The muted stream contained "Use SQLite." once; the final answer repeats
    // it four times in one paragraph. Only one occurrence is thinking.
    const segments = formatAgentReply('Use SQLite.\nUse SQLite.\nUse SQLite.\nUse SQLite.', {
      thinkingLines: new Map([['Use SQLite.', 1]]),
    });
    expect(segments).toEqual([
      { kind: 'text', text: 'Use SQLite. Use SQLite. Use SQLite. Use SQLite.' },
    ]);
  });
});
