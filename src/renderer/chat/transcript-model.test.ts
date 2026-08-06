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
