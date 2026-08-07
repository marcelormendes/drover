import { describe, expect, it } from 'vitest';

import {
  advancePaneOutput,
  applyPaneRead,
  createChatTranscript,
  extractPaneResponse,
  submitUserMessage,
} from '@/renderer/chat/transcript-model';

describe('advancePaneOutput', () => {
  it('synthesizes a newer local revision when Herdr changes text at revision zero', () => {
    expect(
      advancePaneOutput({ text: 'Ready', revision: 0 }, { text: 'Finished', revision: 0 }),
    ).toEqual({ text: 'Finished', revision: 1 });
  });
});

describe('extractPaneResponse', () => {
  it('keeps only new agent output instead of terminal startup and chrome', () => {
    const prompt = 'Reply with exactly: Herdr chat verification passed.';
    const baseline = 'Pi startup help\n\n────────────────────────\n~/workspace\n0.0%';
    const current = [
      'Pi startup help',
      '',
      prompt,
      '',
      'Thinking about the request.',
      '',
      'Herdr chat verification passed.',
      '',
      '────────────────────────',
      '~/workspace',
      '1.0%',
    ].join('\n');

    expect(extractPaneResponse(baseline, current, prompt)).toBe(
      'Thinking about the request.\n\nHerdr chat verification passed.',
    );
  });

  it('finds a submitted prompt after the terminal wraps it and its header shifts', () => {
    const prompt =
      'Produce a deliberately long response with forty numbered paragraphs and a wide table.';
    const baseline = ['pi v0.83.0', '', '────────────────────────', '/workspace', '0.0%'].join(
      '\n',
    );
    const current = [
      '',
      'pi v0.83.0',
      'startup help changed after a redraw',
      '',
      '────────────────────────',
      '',
      'Produce a deliberately long response with forty numbered',
      'paragraphs and a wide table.',
      '',
      'Thinking about the request.',
      '',
      'The long response is streaming now.',
      '',
      '────────────────────────',
      '/workspace',
      '1.0%',
    ].join('\n');

    expect(extractPaneResponse(baseline, current, prompt)).toBe(
      'Thinking about the request.\n\nThe long response is streaming now.',
    );
  });

  it('keeps box-table separators while removing the terminal footer', () => {
    const prompt = 'Show the table';
    const baseline = 'pi startup\n/workspace\n0.0%';
    const current = [
      'pi startup',
      prompt,
      '',
      'Here is the table.',
      '',
      '┌────────────────┬────────────────┐',
      '│ Component      │ Responsibility │',
      '├────────────────┼────────────────┤',
      '│ Transport      │ Stream chunks  │',
      '└────────────────┴────────────────┘',
      '',
      '────────────────────────',
      '/workspace',
      '1.0%',
    ].join('\n');

    expect(extractPaneResponse(baseline, current, prompt)).toContain(
      '├────────────────┼────────────────┤',
    );
    expect(extractPaneResponse(baseline, current, prompt)).not.toContain('/workspace');
  });

  it('keeps the last response when a later terminal snapshot loses the prompt boundary', () => {
    const previous = 'Thinking about the request.\n\nThe complete response.';

    expect(
      extractPaneResponse(
        'pi startup\n/workspace\n0.0%',
        'pi v0.83.0\nstartup help after redraw\n────────────────────────\n/workspace\n1.0%',
        'Original prompt',
        previous,
      ),
    ).toBe(previous);
  });
});

describe('createChatTranscript', () => {
  it('creates an empty transcript without a live response', () => {
    expect(createChatTranscript()).toEqual({
      messages: [],
      activeTurnId: null,
      liveResponseId: null,
    });
  });
});

describe('submitUserMessage', () => {
  it('appends the submitted user message and opens its turn immutably', () => {
    const original = createChatTranscript();

    const next = submitUserMessage(original, {
      submissionId: 'turn-1',
      text: 'Make the chat the default view.',
    });

    expect(next).not.toBe(original);
    expect(original).toEqual({ messages: [], activeTurnId: null, liveResponseId: null });
    expect(next).toEqual({
      messages: [
        {
          id: 'user:turn-1',
          turnId: 'turn-1',
          role: 'user',
          text: 'Make the chat the default view.',
        },
      ],
      activeTurnId: 'turn-1',
      liveResponseId: null,
    });
  });

  it('treats a repeated submission ID as the same user message', () => {
    const first = submitUserMessage(createChatTranscript(), {
      submissionId: 'turn-1',
      text: 'Make the chat the default view.',
    });

    const duplicate = submitUserMessage(first, {
      submissionId: 'turn-1',
      text: 'Make the chat the default view.',
    });

    expect(duplicate).toBe(first);
    expect(duplicate.messages).toHaveLength(1);
  });
});

describe('applyPaneRead', () => {
  it('creates the active turn response from the first pane read', () => {
    const submitted = submitUserMessage(createChatTranscript(), {
      submissionId: 'turn-1',
      text: 'Make the chat the default view.',
    });

    const next = applyPaneRead(submitted, {
      text: 'I am building the chat surface now.',
      revision: 42,
      status: 'working',
    });

    expect(next).not.toBe(submitted);
    expect(submitted.messages).toHaveLength(1);
    expect(next).toEqual({
      messages: [
        submitted.messages[0],
        {
          id: 'assistant:turn-1',
          turnId: 'turn-1',
          role: 'assistant',
          text: 'I am building the chat surface now.',
          revision: 42,
          status: 'working',
        },
      ],
      activeTurnId: 'turn-1',
      liveResponseId: 'assistant:turn-1',
    });
  });

  it('updates the live response in place instead of appending duplicate responses', () => {
    const submitted = submitUserMessage(createChatTranscript(), {
      submissionId: 'turn-1',
      text: 'Make the chat the default view.',
    });
    const firstRead = applyPaneRead(submitted, {
      text: 'Starting the implementation.',
      revision: 42,
      status: 'working',
    });

    const next = applyPaneRead(firstRead, {
      text: 'I need your approval to continue.',
      revision: 43,
      status: 'blocked',
    });

    expect(next).not.toBe(firstRead);
    expect(next.messages).toHaveLength(2);
    expect(next.messages[0]).toBe(firstRead.messages[0]);
    expect(firstRead.messages[1]).toMatchObject({
      text: 'Starting the implementation.',
      revision: 42,
      status: 'working',
    });
    expect(next.messages[1]).toEqual({
      id: 'assistant:turn-1',
      turnId: 'turn-1',
      role: 'assistant',
      text: 'I need your approval to continue.',
      revision: 43,
      status: 'blocked',
    });
    expect(next.liveResponseId).toBe('assistant:turn-1');
  });

  it('returns the existing state for a duplicate pane read', () => {
    const submitted = submitUserMessage(createChatTranscript(), {
      submissionId: 'turn-1',
      text: 'Make the chat the default view.',
    });
    const paneRead = {
      text: 'The implementation is underway.',
      revision: 42,
      status: 'working' as const,
    };
    const firstRead = applyPaneRead(submitted, paneRead);

    expect(applyPaneRead(firstRead, paneRead)).toBe(firstRead);
  });

  it('ignores a stale pane revision that arrives after newer output', () => {
    const submitted = submitUserMessage(createChatTranscript(), {
      submissionId: 'turn-1',
      text: 'Make the chat the default view.',
    });
    const current = applyPaneRead(submitted, {
      text: 'The current response.',
      revision: 42,
      status: 'working',
    });

    const stale = applyPaneRead(current, {
      text: 'An older response.',
      revision: 41,
      status: 'idle',
    });

    expect(stale).toBe(current);
  });
});

describe('applyPaneRead thinking capture', () => {
  it('stores the thinking lines captured while the turn streamed', () => {
    const submitted = submitUserMessage(createChatTranscript(), {
      submissionId: 'turn-1',
      text: 'Fix the layout.',
    });

    const next = applyPaneRead(submitted, {
      text: 'The user wants the layout fixed.\nHere is the fix.',
      revision: 42,
      status: 'working',
      thinkingLines: ['The user wants the layout fixed.'],
    });

    expect(next.messages[1]).toMatchObject({
      text: 'The user wants the layout fixed.\nHere is the fix.',
      thinkingLines: ['The user wants the layout fixed.'],
    });
  });

  it('keeps the captured thinking lines when a later read has none', () => {
    const submitted = submitUserMessage(createChatTranscript(), {
      submissionId: 'turn-1',
      text: 'Fix the layout.',
    });
    const streamed = applyPaneRead(submitted, {
      text: 'The user wants the layout fixed.\nHere is the fix.',
      revision: 42,
      status: 'working',
      thinkingLines: ['The user wants the layout fixed.'],
    });

    // The final frame collapsed the thinking block and lost its markers.
    const completed = applyPaneRead(streamed, {
      text: 'Here is the fix.',
      revision: 43,
      status: 'idle',
      thinkingLines: [],
    });

    expect(completed.messages[1]).toMatchObject({
      text: 'Here is the fix.',
      thinkingLines: ['The user wants the layout fixed.'],
    });
  });

  it('replaces captured thinking lines when a later read carries a fresh set', () => {
    const submitted = submitUserMessage(createChatTranscript(), {
      submissionId: 'turn-1',
      text: 'Fix the layout.',
    });
    const streamed = applyPaneRead(submitted, {
      text: 'First draft.',
      revision: 42,
      status: 'working',
      thinkingLines: ['First draft.'],
    });

    const next = applyPaneRead(streamed, {
      text: 'Second draft.',
      revision: 43,
      status: 'working',
      thinkingLines: ['Second draft.'],
    });

    expect(next.messages[1]).toMatchObject({
      thinkingLines: ['Second draft.'],
    });
  });
});

describe('extractPaneResponse collapse handling', () => {
  it('keeps the fuller streamed response when a final frame collapses it', () => {
    const prompt = 'Fix the layout.';
    const baseline = 'ready';
    const streamed = [
      'ready',
      'Fix the layout.',
      '',
      'The user wants the layout fixed.',
      '',
      '- Here is the fix.',
    ].join('\n');
    const previous = extractPaneResponse(baseline, streamed, prompt);

    // The final frame kept the prompt echo but collapsed the thinking block.
    const collapsedFrame = ['ready', 'Fix the layout.', '', '- Here is the fix.'].join('\n');
    const completed = extractPaneResponse(
      'ready\nFix the layout.\n\nThe user wants the layout fixed.\n\n- Here is the fix.',
      collapsedFrame,
      prompt,
      previous,
      false,
      ['The user wants the layout fixed.'],
    );

    expect(completed).toBe(previous);
  });

  it('grows the response while streaming instead of freezing it', () => {
    const prompt = 'Fix the layout.';
    const baseline = 'ready';
    const first = extractPaneResponse(baseline, 'ready\nFix the layout.\nFirst draft.', prompt);
    const second = extractPaneResponse(
      'ready\nFix the layout.\nFirst draft.',
      'ready\nFix the layout.\nFirst draft.\nSecond draft.',
      prompt,
      first,
    );
    expect(second).toBe('First draft.\nSecond draft.');
  });

  it('uses a completed replacement frame after the prompt and working body roll away', () => {
    const prompt = 'Send this to the reviewer and report the result.';
    const previous = [
      'The reviewer is still checking the changes.',
      '',
      '$ sleep 120 && herdr agent read w2:p5',
      '',
      '⣏ Working...',
    ].join('\n');
    const completedFrame = [
      'Fixed — 49 files, 394 tests passing.',
      '',
      'Root cause',
      '',
      'The final frame replaced the working screen after the prompt rolled away.',
    ].join('\n');

    expect(extractPaneResponse('Ready', completedFrame, prompt, previous, true)).toBe(
      completedFrame,
    );
  });

  it('keeps streaming an active response after the prompt rolls out of the pane window', () => {
    const prompt = 'Send this to the reviewer and report the result.';
    const previous = [
      'The reviewer is still checking the changes.',
      '',
      '$ sleep 120 && herdr agent read w2:p5',
      '',
      'Elapsed 64.8s',
      '',
      'Working...',
    ].join('\n');
    const rolledFrame = [
      '$ sleep 120 && herdr agent read w2:p5',
      '',
      'Elapsed 64.8s',
      '',
      'Working...',
      '',
      'The reviewer found two edge cases.',
      '',
      'Checking one final scenario.',
    ].join('\n');

    expect(extractPaneResponse('Ready', rolledFrame, prompt, previous, false)).toBe(
      [previous, '', 'The reviewer found two edge cases.', '', 'Checking one final scenario.'].join(
        '\n',
      ),
    );
  });
});

describe('extractPaneResponse shrink handling', () => {
  it('keeps the streamed response only when the removed content was captured thinking', () => {
    const prompt = 'Fix the layout.';
    const previous = 'The user wants the layout fixed.\n\n- Here is the fix.';
    const collapsedFrame = 'ready\nFix the layout.\n\n- Here is the fix.';

    const kept = extractPaneResponse(
      'ready\nFix the layout.\n\nThe user wants the layout fixed.\n\n- Here is the fix.',
      collapsedFrame,
      prompt,
      previous,
      false,
      ['The user wants the layout fixed.'],
    );
    expect(kept).toBe(previous);

    // Without captured thinking for the removed content, the shrink stands.
    const shrunk = extractPaneResponse(
      'ready\nFix the layout.\n\nThe user wants the layout fixed.\n\n- Here is the fix.',
      collapsedFrame,
      prompt,
      previous,
      false,
      [],
    );
    expect(shrunk).toBe('- Here is the fix.');
  });

  it('accepts a legitimate shrink while working instead of freezing the draft', () => {
    const prompt = 'Fix the layout.';
    const previous = 'Draft preface.\n\nFinal answer.';
    const rewritten = 'ready\nFix the layout.\n\nFinal answer.';

    const result = extractPaneResponse(
      'ready\nFix the layout.\n\nDraft preface.\n\nFinal answer.',
      rewritten,
      prompt,
      previous,
      false,
      [],
    );
    expect(result).toBe('Final answer.');
  });
});
