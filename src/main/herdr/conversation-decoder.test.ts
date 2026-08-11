import { describe, expect, it } from 'vitest';

import {
  decodeAttachmentBeginResult,
  decodeConversationChangedEvent,
  decodeConversationReadResult,
  decodeConversationRespondResult,
} from '@/main/herdr/conversation-decoder';

describe('decodeConversationReadResult', () => {
  it('decodes the flattened snake-case engine page', () => {
    const result = decodeConversationReadResult({
      type: 'agent_conversation_read',
      read: {
        type: 'page',
        page: {
          provider: 'pi',
          session: { id: 'opaque-session' },
          capability: { availability: 'supported', reason: 'ready' },
          items: [
            {
              id: 'item-1',
              sequence: 1,
              provider: 'pi',
              session_id: 'opaque-session',
              turn_id: 'turn-1',
              type: 'assistant_message',
              phase: 'final',
              text: 'done',
              state: 'completed',
            },
            {
              id: 'item-2',
              sequence: 2,
              provider: 'pi',
              session_id: 'opaque-session',
              type: 'user_message',
              text: '',
              attachments: [{ media_type: 'image/png', name: 'diagram.png', byte_size: 42 }],
            },
          ],
          next_cursor: 'cursor-a',
          has_older: false,
          revision: 2,
          reader_generation: 'generation-a',
        },
      },
    });

    expect(result).toEqual({
      type: 'page',
      page: expect.objectContaining({
        provider: 'pi',
        items: expect.arrayContaining([
          expect.objectContaining({ type: 'assistant_message', text: 'done' }),
          expect.objectContaining({
            type: 'user_message',
            text: '',
            attachments: expect.any(Array),
          }),
        ]),
        next_cursor: 'cursor-a',
      }),
    });
  });

  it('accepts reset_required and rejects path-shaped opaque identity', () => {
    expect(
      decodeConversationReadResult({
        type: 'agent_conversation_read',
        read: {
          type: 'reset_required',
          session: { id: 'opaque-session' },
          reader_generation: 'generation-b',
        },
      }),
    ).toEqual({
      type: 'reset_required',
      session: { id: 'opaque-session' },
      reader_generation: 'generation-b',
    });

    expect(() =>
      decodeConversationReadResult({
        type: 'agent_conversation_read',
        read: {
          type: 'reset_required',
          session: { id: '/home/user/transcript.jsonl' },
          reader_generation: 'generation-b',
        },
      }),
    ).toThrow(/invalid conversation/);
  });

  it('rejects malformed or oversized canonical items', () => {
    expect(() =>
      decodeConversationReadResult({
        type: 'agent_conversation_read',
        read: {
          type: 'page',
          page: {
            provider: 'pi',
            session: { id: 'opaque-session' },
            capability: { availability: 'supported', reason: 'ready' },
            items: [
              {
                id: 'item-1',
                sequence: 1,
                provider: 'pi',
                type: 'assistant_message',
                phase: 'final',
                text: 'x'.repeat(20_000),
                state: 'completed',
              },
            ],
            has_older: false,
            revision: 1,
            reader_generation: 'generation-a',
          },
        },
      }),
    ).toThrow(/invalid conversation/);
  });
});

describe('conversation response decoders', () => {
  it('decodes an idempotent approval response and rejects path-shaped event identities', () => {
    expect(
      decodeConversationRespondResult({
        type: 'agent_conversation_respond',
        result: {
          request_id: 'approval-1',
          decision_id: 'allow',
          accepted: true,
          reason: 'already_resolved',
        },
      }),
    ).toEqual({
      request_id: 'approval-1',
      decision_id: 'allow',
      accepted: true,
      reason: 'already_resolved',
    });
    expect(
      decodeConversationChangedEvent({
        pane_id: 'w1:p1',
        workspace_id: 'w1',
        session: { id: 'session-1' },
        reader_generation: 'generation-1',
        revision: 4,
        reset_required: false,
      }),
    ).toEqual({
      pane_id: 'w1:p1',
      workspace_id: 'w1',
      session: { id: 'session-1' },
      reader_generation: 'generation-1',
      revision: 4,
      reset_required: false,
    });
    expect(
      decodeConversationChangedEvent({
        pane_id: 'w1:p1',
        workspace_id: 'w1',
        session: { id: '/tmp/transcript.jsonl' },
        reader_generation: 'generation-1',
        revision: 4,
        reset_required: false,
      }),
    ).toBeNull();
    expect(
      decodeConversationChangedEvent({
        pane_id: '/tmp/pane',
        workspace_id: 'w1',
        session: { id: 'session-1' },
        reader_generation: 'generation-1',
        revision: 4,
        reset_required: false,
      }),
    ).toBeNull();
    expect(
      decodeConversationChangedEvent({
        pane_id: 'w1:p1',
        workspace_id: 'x'.repeat(257),
        session: { id: 'session-1' },
        reader_generation: 'generation-1',
        revision: 4,
        reset_required: false,
      }),
    ).toBeNull();
  });
});

describe('attachment decoders', () => {
  it('preserves the opaque upload handle shape used by the IPC contract', () => {
    expect(
      decodeAttachmentBeginResult({
        type: 'agent_attachment_begin',
        upload: { handle: 'upload-1' },
        chunk_size: 8192,
      }),
    ).toEqual({
      upload: { handle: 'upload-1' },
      chunk_size: 8192,
    });
  });
});
