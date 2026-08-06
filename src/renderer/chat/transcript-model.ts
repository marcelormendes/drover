import type { AgentStatus } from '@/shared/herdr';

export interface ChatUserMessage {
  readonly id: string;
  readonly turnId: string;
  readonly role: 'user';
  readonly text: string;
}

export interface ChatAssistantMessage {
  readonly id: string;
  readonly turnId: string;
  readonly role: 'assistant';
  readonly text: string;
  readonly revision: number;
  readonly status: AgentStatus;
}

export type ChatTranscriptMessage = ChatUserMessage | ChatAssistantMessage;

export interface ChatTranscript {
  readonly messages: readonly ChatTranscriptMessage[];
  readonly activeTurnId: string | null;
  readonly liveResponseId: string | null;
}

export interface UserMessageSubmission {
  readonly submissionId: string;
  readonly text: string;
}

export interface PaneReadProjection {
  readonly text: string;
  readonly revision: number;
  readonly status: AgentStatus;
}

interface PaneOutputProjection {
  readonly text: string;
  readonly revision: number;
}

export function advancePaneOutput<T extends PaneOutputProjection>(
  previous: T | undefined,
  next: T,
): T {
  if (!previous || next.revision > previous.revision) {
    return next;
  }
  if (next.text === previous.text) {
    return previous;
  }
  return { ...next, revision: previous.revision + 1 };
}

export function extractPaneResponse(baseline: string, current: string, prompt: string): string {
  if (baseline === current) {
    return '';
  }

  let sharedPrefixLength = 0;
  const maximumPrefixLength = Math.min(baseline.length, current.length);
  while (
    sharedPrefixLength < maximumPrefixLength &&
    baseline[sharedPrefixLength] === current[sharedPrefixLength]
  ) {
    sharedPrefixLength += 1;
  }
  const precedingLineBreak = current.lastIndexOf('\n', Math.max(0, sharedPrefixLength - 1));
  const candidate = current.slice(precedingLineBreak === -1 ? 0 : precedingLineBreak + 1);
  const lines = candidate.split('\n').filter((line) => line.trim() !== prompt.trim());
  const terminalFooterIndex = lines.findIndex((line) => /[─━═]{12,}/.test(line));
  return (terminalFooterIndex === -1 ? lines : lines.slice(0, terminalFooterIndex))
    .join('\n')
    .trim();
}

export function createChatTranscript(): ChatTranscript {
  return {
    messages: [],
    activeTurnId: null,
    liveResponseId: null,
  };
}

export function submitUserMessage(
  transcript: ChatTranscript,
  submission: UserMessageSubmission,
): ChatTranscript {
  const messageId = `user:${submission.submissionId}`;
  if (transcript.messages.some((message) => message.id === messageId)) {
    return transcript;
  }

  return {
    messages: [
      ...transcript.messages,
      {
        id: messageId,
        turnId: submission.submissionId,
        role: 'user',
        text: submission.text,
      },
    ],
    activeTurnId: submission.submissionId,
    liveResponseId: null,
  };
}

export function applyPaneRead(
  transcript: ChatTranscript,
  paneRead: PaneReadProjection,
): ChatTranscript {
  const turnId = transcript.activeTurnId;
  if (turnId === null) {
    return transcript;
  }

  const responseId = `assistant:${turnId}`;
  const response: ChatAssistantMessage = {
    id: responseId,
    turnId,
    role: 'assistant',
    text: paneRead.text,
    revision: paneRead.revision,
    status: paneRead.status,
  };
  const responseIndex = transcript.messages.findIndex((message) => message.id === responseId);
  const currentResponse = transcript.messages[responseIndex];
  if (currentResponse?.role === 'assistant' && currentResponse.revision > paneRead.revision) {
    return transcript;
  }
  if (
    currentResponse?.role === 'assistant' &&
    currentResponse.text === paneRead.text &&
    currentResponse.revision === paneRead.revision &&
    currentResponse.status === paneRead.status
  ) {
    return transcript;
  }
  const messages =
    responseIndex === -1
      ? [...transcript.messages, response]
      : transcript.messages.map((message, index) => (index === responseIndex ? response : message));

  return {
    messages,
    activeTurnId: turnId,
    liveResponseId: responseId,
  };
}
