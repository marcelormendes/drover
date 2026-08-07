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
  /**
   * Muted lines captured from the live pane output while the turn streamed.
   * Agent CLIs re-render or collapse the thinking block when they finish, so
   * the markers are captured while working and kept for the final render.
   */
  readonly thinkingLines?: readonly string[];
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
  readonly thinkingLines?: ReadonlyArray<string>;
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

const TERMINAL_FOOTER_RULE = /^\s*[─━═]{12,}\s*$/;

function escapedPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedTextEnd(text: string, wanted: string): number {
  const words = wanted.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return -1;
  }
  const pattern = new RegExp(words.map(escapedPattern).join('\\s+'), 'g');
  let end = -1;
  for (const match of text.matchAll(pattern)) {
    end = (match.index ?? 0) + match[0].length;
  }
  return end;
}

/** Lines present in the previous response but absent from the current one. */
function removedLines(previousResponse: string, response: string): string[] {
  const kept = new Set(
    response
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
  return previousResponse
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !kept.has(line));
}

function mergeRolledResponse(previousResponse: string, response: string): string | undefined {
  const previousLines = previousResponse.split('\n');
  const responseLines = response.split('\n');
  if (previousLines.length === 0) {
    return undefined;
  }

  // Agent TUIs redraw their spinner and may rewrite the line immediately
  // above it. Search a small tail window instead of requiring the final line
  // to survive verbatim. A fast model can otherwise advance a rolled pane
  // between reads while the changing `Working...` line makes the substantial
  // overlap just before it invisible.
  const previousTailStart = Math.max(0, previousLines.length - 32);
  let bestOverlap = 0;
  let bestPreviousEnd = -1;
  let bestResponseEnd = -1;
  for (
    let previousEnd = previousLines.length - 1;
    previousEnd >= previousTailStart;
    previousEnd -= 1
  ) {
    const previousLine = previousLines[previousEnd];
    for (let responseEnd = 0; responseEnd < responseLines.length; responseEnd += 1) {
      if (!responseLines[responseEnd]?.startsWith(previousLine)) {
        continue;
      }
      let overlap = 1;
      while (
        overlap <= previousEnd &&
        overlap <= responseEnd &&
        previousLines[previousEnd - overlap] === responseLines[responseEnd - overlap]
      ) {
        overlap += 1;
      }
      const meaningfulOverlap = previousLines
        .slice(previousEnd - overlap + 1, previousEnd + 1)
        .filter((line) => line.trim());
      const rewritesTrailingLines = previousEnd < previousLines.length - 1;
      if (
        (rewritesTrailingLines && meaningfulOverlap.length < 2) ||
        (meaningfulOverlap.length < 2 && meaningfulOverlap.join('\n').length < 40)
      ) {
        continue;
      }
      if (
        previousEnd > bestPreviousEnd ||
        (previousEnd === bestPreviousEnd && overlap > bestOverlap)
      ) {
        bestOverlap = overlap;
        bestPreviousEnd = previousEnd;
        bestResponseEnd = responseEnd;
      }
    }
  }

  if (bestPreviousEnd === -1) {
    return undefined;
  }
  return [
    ...previousLines.slice(0, bestPreviousEnd),
    responseLines[bestResponseEnd],
    ...responseLines.slice(bestResponseEnd + 1),
  ]
    .join('\n')
    .trim();
}

function trimTerminalFooter(text: string): string {
  const lines = text.split('\n');
  const footerIndex = lines.findIndex((line, index) => {
    if (!TERMINAL_FOOTER_RULE.test(line)) {
      return false;
    }
    const remainingLines = lines.slice(index + 1).filter((item) => item.trim() !== '');
    return remainingLines.length <= 8;
  });
  return (footerIndex === -1 ? lines : lines.slice(0, footerIndex)).join('\n').trim();
}

export function extractPaneResponse(
  baseline: string,
  current: string,
  prompt: string,
  previousResponse = '',
  turnComplete = false,
  capturedThinking: readonly string[] = [],
): string {
  if (baseline === current) {
    return previousResponse;
  }

  // Agent TUIs echo a submitted prompt, but wrap it to the current terminal
  // width. Anchor after that echo instead of relying on the top of a terminal
  // snapshot, which can shift whenever the TUI redraws or its history rolls.
  const promptEnd = normalizedTextEnd(current, prompt);
  if (promptEnd !== -1) {
    const response = trimTerminalFooter(current.slice(promptEnd));
    // A re-rendered final frame can collapse or roll content that already
    // streamed. Keep the fuller previous response only when the removed
    // content is known captured thinking; a legitimate rewrite that shrinks
    // the answer must not freeze the draft.
    if (
      previousResponse &&
      response &&
      previousResponse.includes(response) &&
      response.length < previousResponse.length
    ) {
      const removed = removedLines(previousResponse, response);
      const removedIsCapturedThinking =
        removed.length > 0 && removed.every((line) => capturedThinking.includes(line));
      if (removedIsCapturedThinking) {
        return previousResponse;
      }
    }
    return response;
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
  const response = trimTerminalFooter(
    candidate
      .split('\n')
      .filter((line) => line.trim() !== prompt.trim())
      .join('\n'),
  );
  if (!previousResponse) {
    return response;
  }
  if (response.includes(previousResponse)) {
    return response;
  }
  if (previousResponse.includes(response)) {
    return previousResponse;
  }
  const mergedResponse = mergeRolledResponse(previousResponse, response);
  if (mergedResponse) {
    return mergedResponse;
  }
  if (turnComplete && response) {
    return response;
  }
  // Once a turn has a trustworthy response boundary, an unrelated snapshot
  // without its prompt is terminal chrome or a rolled window, not a new reply.
  return previousResponse;
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
  const responseIndex = transcript.messages.findIndex((message) => message.id === responseId);
  const currentResponse = transcript.messages[responseIndex];
  if (currentResponse?.role === 'assistant' && currentResponse.revision > paneRead.revision) {
    return transcript;
  }
  // A final frame that collapsed or recolored the thinking block carries no
  // (or fewer) markers; keep the set captured while the turn streamed. Only a
  // read with genuinely new muted lines replaces it — a strict subset just
  // means the CLI recolored part of the thinking to the answer foreground.
  let thinkingLines =
    paneRead.thinkingLines && paneRead.thinkingLines.length > 0
      ? [...paneRead.thinkingLines]
      : currentResponse?.role === 'assistant'
        ? currentResponse.thinkingLines
        : undefined;
  if (
    paneRead.thinkingLines &&
    paneRead.thinkingLines.length > 0 &&
    currentResponse?.role === 'assistant' &&
    currentResponse.thinkingLines &&
    currentResponse.thinkingLines.length > 0
  ) {
    // Reconcile by occurrence instead of wholesale replace: keep captured
    // lines that still survive in the read text even when the frame lost
    // their markers, and take the higher count when a line repeats.
    const textLines = new Set(
      paneRead.text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    );
    const countLines = (lines: readonly string[]): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const line of lines) {
        counts.set(line, (counts.get(line) ?? 0) + 1);
      }
      return counts;
    };
    const merged = new Map<string, number>();
    for (const [line, count] of countLines(currentResponse.thinkingLines)) {
      if (textLines.has(line)) {
        merged.set(line, Math.max(merged.get(line) ?? 0, count));
      }
    }
    // Fresh muted lines come from the current frame itself, so they are in
    // the text by construction; keep their counts as-is.
    for (const [line, count] of countLines(paneRead.thinkingLines ?? [])) {
      merged.set(line, Math.max(merged.get(line) ?? 0, count));
    }
    thinkingLines = [...merged].flatMap(([line, count]) => Array<string>(count).fill(line));
  }
  const response: ChatAssistantMessage = {
    id: responseId,
    turnId,
    role: 'assistant',
    text: paneRead.text,
    revision: paneRead.revision,
    status: paneRead.status,
    ...(thinkingLines ? { thinkingLines } : {}),
  };
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
