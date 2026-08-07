import {
  AlertTriangle,
  Bot,
  ListChecks,
  LoaderCircle,
  Send,
  SquareTerminal,
  X,
} from 'lucide-react';
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { parseAnsiLines, responseThinkingLines, stripAnsi } from '@/renderer/chat/ansi-text';
import {
  formatAgentReply,
  stripEchoedPrompt,
  type ThinkingLines,
} from '@/renderer/chat/reply-format';
import { detectTerminalMenu, menuSelectionKeys } from '@/renderer/chat/terminal-menu';
import {
  advancePaneOutput,
  applyPaneRead,
  type ChatTranscriptMessage,
  createChatTranscript,
  extractPaneResponse,
  submitUserMessage,
} from '@/renderer/chat/transcript-model';
import { statusDotClass } from '@/renderer/status';
import type { ChatImageDraft, HerdrQueryResult } from '@/shared/desktop-api';
import {
  MAX_CHAT_IMAGE_ATTACHMENTS,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_TOTAL_BYTES,
} from '@/shared/desktop-api';
import type { HerdrEventEnvelope } from '@/shared/events';
import type { PaneInfo } from '@/shared/herdr';

export type PaneOutput = Extract<HerdrQueryResult, { type: 'pane-output' }>;

const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'gif', 'webp', 'bmp']);

const PANE_ACTIVITY_EVENTS = new Set([
  'pane.output_changed',
  'pane.scroll_changed',
  'pane.agent_status_changed',
  'pane.updated',
]);

function eventTargetsPane(event: HerdrEventEnvelope, paneId: string): boolean {
  if (event.event === 'desktop.resynchronized') {
    return true;
  }
  if (!PANE_ACTIVITY_EVENTS.has(event.event)) {
    return false;
  }
  const nestedPane = event.data.pane;
  const nestedPaneId =
    typeof nestedPane === 'object' && nestedPane !== null && 'pane_id' in nestedPane
      ? (nestedPane as Record<string, unknown>).pane_id
      : undefined;
  return event.data.pane_id === paneId || nestedPaneId === paneId;
}

export interface ChatAttachment {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly blob: Blob;
  readonly extension: string;
}

function imageExtension(file: File): string | undefined {
  const fromType = IMAGE_EXTENSION_BY_TYPE[file.type];
  if (fromType) {
    return fromType;
  }
  const match = /\.([a-z0-9]+)$/i.exec(file.name);
  if (match) {
    const extension = match[1].toLocaleLowerCase();
    if (extension === 'jpeg') {
      return 'jpg';
    }
    if (IMAGE_EXTENSIONS.has(extension)) {
      return extension;
    }
  }
  return undefined;
}

function imageFiles(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return [];
  }
  const files: File[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file && imageExtension(file)) {
        files.push(file);
      }
    }
  }
  if (files.length === 0) {
    for (const file of Array.from(dataTransfer.files ?? [])) {
      if (imageExtension(file)) {
        files.push(file);
      }
    }
  }
  return files;
}

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

function bracketedPaste(text: string): string {
  // The agent CLI reads a pasted image path and attaches the image, exactly
  // like a paste in Herdr's own terminal.
  return `\x1b[200~${text}\x1b[201~`;
}

function imageReference(index: number): string {
  return `[Image #${index + 1}]`;
}

function messageWithImageReferences(text: string, imageCount: number): string {
  const references = Array.from({ length: imageCount }, (_, index) => imageReference(index)).join(
    '\n',
  );
  return [references, text].filter(Boolean).join('\n\n');
}

function turnIsComplete(status: PaneInfo['agent_status']): boolean {
  return status === 'idle' || status === 'done';
}

export interface ChatSessionState {
  readonly draft: string;
  readonly attachments: readonly ChatAttachment[];
  readonly transcript: ReturnType<typeof createChatTranscript>;
  readonly output?: PaneOutput;
  readonly baselineRevision?: number;
  readonly baselineText?: string;
  readonly pollUntil?: number;
}

export function createChatSessionState(): ChatSessionState {
  return {
    draft: '',
    attachments: [],
    transcript: createChatTranscript(),
  };
}

export type ChatSessionUpdate = (current: ChatSessionState) => ChatSessionState;

function AgentReply({
  text,
  echo,
  thinkingLines,
  muted,
}: {
  text: string;
  echo?: string;
  thinkingLines?: ThinkingLines;
  // While the agent is working, everything it prints is provisional: render
  // the whole turn in gray until the final reply lands in white.
  muted?: boolean;
}) {
  const segments = useMemo(() => {
    const occurrences = new Map<string, number>();
    return stripEchoedPrompt(formatAgentReply(text, { thinkingLines }), echo).map((segment) => {
      const seen = (occurrences.get(segment.text) ?? 0) + 1;
      occurrences.set(segment.text, seen);
      return { ...segment, key: `${segment.kind}:${seen}:${segment.text}` };
    });
  }, [text, echo, thinkingLines]);
  if (segments.length === 0) {
    return null;
  }
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2.5" data-slot="agent-reply">
      {segments.map((segment) =>
        segment.kind === 'pre' ? (
          // Tables and code keep terminal spacing, so they scroll instead of wrap.
          <pre
            className={cn(
              'min-w-0 max-w-full overflow-x-auto rounded-base border-2 border-border bg-secondary-background p-3 font-mono text-xs leading-5',
              muted ? 'text-thinking-foreground' : 'text-response-foreground',
            )}
            key={segment.key}
          >
            {segment.text}
          </pre>
        ) : (
          <p
            className={cn(
              'break-words text-sm leading-6',
              muted
                ? 'text-thinking-foreground'
                : segment.tone === 'thinking' &&
                    'border-l-2 border-main pl-3 text-[13px] italic text-thinking-foreground',
              !muted && segment.tone !== 'thinking' && 'text-response-foreground',
            )}
            key={segment.key}
          >
            {segment.text}
          </p>
        ),
      )}
    </div>
  );
}

interface ChatPanelProps {
  pane: PaneInfo;
  readOutput: (paneId: string) => Promise<PaneOutput>;
  onPrompt: (target: string, text: string) => void | Promise<void>;
  onSendInput?: (paneId: string, input: { text?: string; keys?: string[] }) => void | Promise<void>;
  onOpenTerminal?: () => void;
  stageImages?: (images: ChatImageDraft[]) => Promise<string[]>;
  session?: ChatSessionState;
  onSessionChange?: (update: ChatSessionUpdate) => void;
}

export function ChatPanel({
  pane,
  readOutput,
  onPrompt,
  onSendInput,
  onOpenTerminal,
  stageImages,
  session: controlledSession,
  onSessionChange,
}: ChatPanelProps) {
  const agentName = pane.display_agent || pane.agent || 'Agent';
  const [internalSession, setInternalSession] = useState(createChatSessionState);
  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;
  const updateSession = useCallback((update: ChatSessionUpdate) => {
    const changeControlledSession = onSessionChangeRef.current;
    if (changeControlledSession) {
      changeControlledSession(update);
    } else {
      setInternalSession(update);
    }
  }, []);
  const session = controlledSession || internalSession;
  const { draft, transcript, output } = session;
  const attachments = session.attachments ?? [];
  const [refreshError, setRefreshError] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachmentNotice, setAttachmentNotice] = useState<string>();
  const submissionSequenceRef = useRef(0);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);
  const addAttachments = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        return;
      }
      let totalBytes = attachments.reduce((sum, attachment) => sum + attachment.blob.size, 0);
      const accepted: ChatAttachment[] = [];
      let skippedForCount = 0;
      let skippedForSize = 0;
      for (const file of files) {
        const extension = imageExtension(file);
        if (!extension) {
          continue;
        }
        if (file.size === 0 || file.size > MAX_CHAT_IMAGE_BYTES) {
          skippedForSize += 1;
          continue;
        }
        if (
          attachments.length + accepted.length >= MAX_CHAT_IMAGE_ATTACHMENTS ||
          totalBytes + file.size > MAX_CHAT_IMAGE_TOTAL_BYTES
        ) {
          skippedForCount += 1;
          continue;
        }
        accepted.push({
          id: `${file.name}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
          name: file.name,
          url: URL.createObjectURL(file),
          blob: file,
          extension,
        });
        totalBytes += file.size;
      }
      if (accepted.length > 0) {
        updateSession((current) => ({
          ...current,
          attachments: [...(current.attachments ?? []), ...accepted],
        }));
        setAttachmentNotice(undefined);
      }
      if (skippedForSize > 0) {
        setAttachmentNotice(
          `Images must be between 1 byte and ${MAX_CHAT_IMAGE_BYTES / 1024 / 1024} MiB.`,
        );
      } else if (skippedForCount > 0) {
        setAttachmentNotice(
          skippedForCount === files.length
            ? 'Image limit reached — remove an attachment to add more.'
            : 'Some images were skipped because the attachment limit was reached.',
        );
      }
    },
    [attachments, updateSession],
  );
  const removeAttachment = useCallback(
    (id: string) => {
      const removed = attachments.find((attachment) => attachment.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.url);
      }
      updateSession((current) => ({
        ...current,
        attachments: (current.attachments ?? []).filter((attachment) => attachment.id !== id),
      }));
      setAttachmentNotice(undefined);
    },
    [attachments, updateSession],
  );
  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = imageFiles(event.clipboardData);
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      addAttachments(files);
    },
    [addAttachments],
  );
  const handleDrop = useCallback(
    (event: DragEvent<HTMLFormElement>) => {
      const files = imageFiles(event.dataTransfer);
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      addAttachments(files);
    },
    [addAttachments],
  );
  const handleDragOver = useCallback((event: DragEvent<HTMLFormElement>) => {
    // During drag-over the drag store is protected: payload data is not
    // readable, only the declared types are. Read files only on drop.
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (!types.includes('Files')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);
  const followVersion = `${output?.revision ?? 0}:${transcript.messages.length}`;

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }
    const updateFollowMode = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      followOutputRef.current = distanceFromBottom <= 48;
    };
    viewport.addEventListener('scroll', updateFollowMode, { passive: true });
    return () => viewport.removeEventListener('scroll', updateFollowMode);
  }, []);

  useLayoutEffect(() => {
    void followVersion;
    const viewport = scrollViewportRef.current;
    if (viewport && followOutputRef.current) {
      viewport.scrollTo({ top: viewport.scrollHeight });
    }
  }, [followVersion]);

  const outputView = useMemo(() => {
    const lines = parseAnsiLines(output?.text ?? '');
    const thinking = new Set<string>();
    for (const line of lines) {
      if (line.thinking && line.text.trim()) {
        thinking.add(line.text.trim());
      }
    }
    return { plain: lines.map((line) => line.text).join('\n'), thinking };
  }, [output]);
  const terminalMenu = useMemo(
    () => (onSendInput && output ? detectTerminalMenu(outputView.plain) : null),
    [onSendInput, output, outputView.plain],
  );
  const answerMenu = useCallback(
    (keys: string[]) => {
      if (!onSendInput) {
        return;
      }
      void onSendInput(pane.pane_id, { keys });
      // Keep polling so the menu view follows the CLI's screen.
      updateSession((current) => ({
        ...current,
        pollUntil: Math.max(current.pollUntil ?? 0, Date.now() + 10_000),
      }));
    },
    [onSendInput, pane.pane_id, updateSession],
  );

  useEffect(() => {
    void pane.revision;
    let active = true;
    let refreshing = false;
    let refreshQueued = false;
    const refresh = async () => {
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      try {
        const next = await readOutput(pane.pane_id);
        if (!active) {
          return;
        }
        updateSession((current) => {
          const currentOutput = current.output;
          const nextOutput = advancePaneOutput(currentOutput, next);
          const outputChanged = nextOutput !== currentOutput;
          const activeTurnId = current.transcript.activeTurnId;
          const activePrompt = current.transcript.messages.find(
            (message) => message.role === 'user' && message.turnId === activeTurnId,
          )?.text;
          const previousResponse = current.transcript.messages.find(
            (message) => message.role === 'assistant' && message.turnId === activeTurnId,
          );
          const responseText =
            current.baselineText !== undefined && activePrompt !== undefined
              ? extractPaneResponse(
                  current.baselineText,
                  stripAnsi(nextOutput.text),
                  activePrompt,
                  previousResponse?.text,
                  turnIsComplete(pane.agent_status) &&
                    previousResponse?.role === 'assistant' &&
                    previousResponse.status === 'working',
                  previousResponse?.role === 'assistant'
                    ? previousResponse.thinkingLines
                    : undefined,
                )
              : '';
          const nextTranscript = responseText
            ? applyPaneRead(current.transcript, {
                text: responseText,
                revision: nextOutput.revision,
                status: pane.agent_status,
                thinkingLines: responseThinkingLines(nextOutput.text, responseText),
              })
            : current.transcript;
          const nextPollUntil =
            outputChanged && responseText && pane.agent_status !== 'working'
              ? Date.now() + 5_000
              : current.pollUntil;
          if (
            nextOutput === currentOutput &&
            nextTranscript === current.transcript &&
            nextPollUntil === current.pollUntil
          ) {
            return current;
          }
          return {
            ...current,
            output: nextOutput,
            transcript: nextTranscript,
            pollUntil: nextPollUntil,
          };
        });
        setRefreshError(false);
      } catch {
        if (active) {
          setRefreshError(true);
        }
      } finally {
        refreshing = false;
        if (active && refreshQueued) {
          refreshQueued = false;
          void refresh();
        }
      }
    };
    void refresh();
    const menuVisible = Boolean(terminalMenu);
    const stopEvents = window.herdr?.onSessionEvent((event) => {
      if (eventTargetsPane(event, pane.pane_id)) {
        void refresh();
      }
    });
    let pollTimer: number | undefined;
    const schedulePoll = () => {
      if (!active) {
        return;
      }
      const rapid =
        pane.agent_status === 'working' ||
        menuVisible ||
        Boolean(transcript.activeTurnId && (session.pollUntil ?? 0) > Date.now());
      pollTimer = window.setTimeout(
        () => {
          if (!active) {
            return;
          }
          void refresh();
          schedulePoll();
        },
        rapid ? 250 : 1_500,
      );
    };
    schedulePoll();
    return () => {
      active = false;
      stopEvents?.();
      if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [
    pane.agent_status,
    pane.pane_id,
    pane.revision,
    readOutput,
    session.pollUntil,
    terminalMenu,
    transcript.activeTurnId,
    updateSession,
  ]);

  const commandDraft = Boolean(onSendInput) && draft.trimStart().startsWith('/');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && attachments.length === 0) || sending) {
      return;
    }
    const asCommand = Boolean(onSendInput) && text.startsWith('/');
    const submittedAttachments = attachments.map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
    }));
    const submissionText = messageWithImageReferences(text, submittedAttachments.length);
    submissionSequenceRef.current += 1;
    const submissionId = `${pane.pane_id}:${Date.now()}:${submissionSequenceRef.current}`;
    setSendError(false);
    setSending(true);
    updateSession((current) => ({ ...current, draft: '' }));
    // Refresh the pane before this turn starts: a still-active previous turn
    // gets finalized with its real reply, and the new baseline includes that
    // reply so it cannot leak into this turn's response.
    let freshOutput: PaneOutput | undefined;
    try {
      freshOutput = await readOutput(pane.pane_id);
    } catch {
      freshOutput = undefined;
    }
    updateSession((current) => {
      const output = freshOutput ? advancePaneOutput(current.output, freshOutput) : current.output;
      const plainOutput = stripAnsi(output?.text ?? '');
      const activeTurnId = current.transcript.activeTurnId;
      const activePrompt = current.transcript.messages.find(
        (message) => message.role === 'user' && message.turnId === activeTurnId,
      )?.text;
      const currentResponse = current.transcript.messages.find(
        (message) => message.role === 'assistant' && message.turnId === activeTurnId,
      )?.text;
      const previousResponse =
        output && current.baselineText !== undefined && activePrompt !== undefined
          ? extractPaneResponse(
              current.baselineText,
              plainOutput,
              activePrompt,
              currentResponse,
              turnIsComplete(pane.agent_status),
            )
          : '';
      const transcript = previousResponse
        ? applyPaneRead(current.transcript, {
            text: previousResponse,
            revision: output?.revision ?? 0,
            status: pane.agent_status,
            thinkingLines: responseThinkingLines(output?.text ?? '', previousResponse),
          })
        : current.transcript;
      return {
        ...current,
        output,
        baselineRevision: output?.revision ?? 0,
        baselineText: plainOutput,
        pollUntil: Date.now() + 30_000,
        transcript: submitUserMessage(transcript, { submissionId, text: submissionText }),
      };
    });
    try {
      const stagedPaths =
        submittedAttachments.length === 0
          ? []
          : await stageImages?.(
              await Promise.all(
                submittedAttachments.map(async (attachment) => {
                  const found = attachments.find((item) => item.id === attachment.id);
                  if (!found) {
                    throw new Error('Image attachment disappeared before sending.');
                  }
                  return {
                    extension: found.extension,
                    data: await readBlobAsBase64(found.blob),
                  };
                }),
              ),
            );
      if (!stagedPaths) {
        throw new Error('Image staging is unavailable.');
      }
      for (const path of stagedPaths) {
        if (onSendInput) {
          await onSendInput(pane.pane_id, { text: bracketedPaste(path) });
        }
      }
      if (asCommand && onSendInput) {
        // Slash commands belong to the agent CLI. Send them as typed input —
        // exactly what typing in the terminal does — so the CLI's own command
        // handling runs instead of receiving the text as a pasted prompt.
        await onSendInput(pane.pane_id, { text, keys: ['enter'] });
      } else {
        await onPrompt(pane.pane_id, submissionText);
      }
      if (submittedAttachments.length > 0) {
        // Remove only the attachments that were submitted; anything pasted or
        // dropped while the send was in flight stays in the composer.
        const submittedIds = new Set(submittedAttachments.map((attachment) => attachment.id));
        updateSession((current) => ({
          ...current,
          attachments: (current.attachments ?? []).filter(
            (attachment) => !submittedIds.has(attachment.id),
          ),
        }));
        for (const attachment of submittedAttachments) {
          URL.revokeObjectURL(attachment.url);
        }
      }
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const messageCard = (message: ChatTranscriptMessage) =>
    message.role === 'user' ? (
      <article
        className="ml-6 min-w-0 max-w-full rounded-base border-2 border-main bg-accent-surface p-3 text-accent-surface-foreground sm:ml-16"
        key={message.id}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-6">
          {message.text || 'Image attachment'}
        </p>
      </article>
    ) : (
      <article className="mr-6 min-w-0 max-w-full sm:mr-16" key={message.id}>
        <div className="mb-2 flex items-center gap-2 font-mono text-xs opacity-70">
          <Bot aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{agentName}</span>
          <span className="ml-auto shrink-0">{message.status}</span>
        </div>
        <AgentReply
          echo={
            transcript.messages.find(
              (item) => item.role === 'user' && item.turnId === message.turnId,
            )?.text
          }
          muted={message.status === 'working'}
          text={message.text}
          thinkingLines={
            message.thinkingLines && message.thinkingLines.length > 0
              ? message.thinkingLines
              : outputView.thinking
          }
        />
      </article>
    );

  return (
    <section
      aria-label={`Chat with ${agentName}`}
      className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-background"
    >
      <div className="flex shrink-0 items-center gap-2 border-b-2 border-border bg-secondary-background px-3 py-1.5">
        <span aria-hidden="true" className={statusDotClass(pane.agent_status)} />
        <h2 className="min-w-0 truncate font-mono text-xs">{agentName}</h2>
        <span className="shrink-0 font-mono text-xs opacity-60">{pane.agent_status}</span>
        <span className="ml-auto min-w-0 truncate font-mono text-[11px] opacity-50">
          {pane.pane_id}
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1" viewportRef={scrollViewportRef}>
        <div
          aria-label={`Conversation with ${agentName}`}
          aria-live="polite"
          className="mx-auto flex min-w-0 w-full max-w-full flex-col gap-4 overflow-hidden p-4 sm:max-w-6xl sm:p-6"
          role="log"
        >
          {pane.agent_status === 'blocked' ? (
            <div className="flex items-center gap-3 rounded-base border-2 border-border bg-chart-2 p-3 text-main-foreground shadow-shadow">
              <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-heading">This agent needs attention.</p>
                <p className="text-xs opacity-75">Use the terminal for its interactive prompt.</p>
              </div>
              {onOpenTerminal ? (
                <Button onClick={onOpenTerminal} size="sm" variant="neutral">
                  <SquareTerminal aria-hidden="true" /> Open terminal
                </Button>
              ) : null}
            </div>
          ) : null}

          {transcript.messages.length === 0 ? (
            <article className="mr-6 min-w-0 max-w-full sm:mr-16">
              <div className="mb-1.5 flex items-center gap-2 font-mono text-xs opacity-70">
                <Bot aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">Current {agentName} output</span>
              </div>
              {output?.text ? (
                <AgentReply
                  muted={pane.agent_status === 'working'}
                  text={outputView.plain}
                  thinkingLines={outputView.thinking}
                />
              ) : (
                <p className="text-sm opacity-65">
                  Send a message to start working with this agent.
                </p>
              )}
              {output?.truncated ? (
                <p className="mt-3 border-t-2 border-border pt-2 font-mono text-xs opacity-65">
                  Older terminal output was truncated by Herdr.
                </p>
              ) : null}
            </article>
          ) : (
            transcript.messages.map(messageCard)
          )}

          {transcript.activeTurnId && !transcript.liveResponseId ? (
            <article
              aria-live="polite"
              className="mr-6 flex items-center gap-2 font-mono text-xs opacity-70 sm:mr-16"
            >
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              <p>Waiting for new agent output…</p>
            </article>
          ) : null}

          {refreshError ? (
            <p aria-live="polite" className="text-center text-xs opacity-65">
              Live output could not refresh.
            </p>
          ) : null}
          {sendError ? (
            <p aria-live="polite" className="text-center text-xs text-destructive">
              Herdr could not send this message. Your text remains in the conversation.
            </p>
          ) : null}
        </div>
      </ScrollArea>

      {terminalMenu ? (
        <section
          aria-label={`${agentName} menu options`}
          className="shrink-0 border-t-2 border-border bg-secondary-background px-3 py-2 sm:px-4"
        >
          <div className="mx-auto max-w-6xl">
            <p className="mb-1.5 flex items-center gap-2 font-mono text-[11px] opacity-70">
              <ListChecks aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{agentName} is asking you to choose</span>
              {terminalMenu.position ? (
                <span className="ml-auto shrink-0">{terminalMenu.position}</span>
              ) : null}
            </p>
            <div className="max-h-44 overflow-y-auto rounded-base border-2 border-border bg-background">
              {terminalMenu.options.map((option, index) => (
                <button
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs hover:bg-accent-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                    index === terminalMenu.selectedIndex && 'bg-accent-surface text-main',
                  )}
                  key={option}
                  onClick={() => answerMenu(menuSelectionKeys(terminalMenu, index))}
                  type="button"
                >
                  <span aria-hidden="true" className="w-3 shrink-0">
                    {index === terminalMenu.selectedIndex ? '→' : ''}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option}</span>
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Button
                className="h-7 px-2 text-xs"
                onClick={() => answerMenu(['esc'])}
                size="sm"
                variant="neutral"
              >
                Cancel (esc)
              </Button>
              {onOpenTerminal ? (
                <Button
                  className="h-7 px-2 text-xs"
                  onClick={onOpenTerminal}
                  size="sm"
                  variant="neutral"
                >
                  <SquareTerminal aria-hidden="true" /> Open terminal
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      <form
        className="shrink-0 border-t-2 border-border bg-secondary-background p-3 sm:p-4"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onSubmit={submit}
      >
        {commandDraft ? (
          <p aria-live="polite" className="mx-auto mb-2 max-w-6xl font-mono text-[11px] text-main">
            Slash command — runs in the {agentName} CLI, exactly like typing in the terminal
          </p>
        ) : null}
        {attachmentNotice ? (
          <p aria-live="polite" className="mx-auto mb-2 max-w-6xl text-xs opacity-75">
            {attachmentNotice}
          </p>
        ) : null}
        {attachments.length > 0 ? (
          <div className="mx-auto mb-2 flex max-w-6xl flex-wrap gap-2">
            {attachments.map((attachment, index) => (
              <article
                className="flex items-center gap-2 rounded-base border-2 border-border bg-background p-1.5"
                data-slot="attachment-chip"
                key={attachment.id}
              >
                <img
                  alt={attachment.name}
                  className="size-10 rounded-sm object-cover"
                  src={attachment.url}
                />
                <span className="max-w-40 font-mono text-[11px]">
                  <span className="block text-main">{imageReference(index)}</span>
                  <span className="block truncate opacity-65">{attachment.name}</span>
                </span>
                <Button
                  aria-label={`Remove ${attachment.name}`}
                  className="size-6"
                  onClick={() => removeAttachment(attachment.id)}
                  size="icon"
                  type="button"
                  variant="neutral"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </Button>
              </article>
            ))}
          </div>
        ) : null}
        <div className="mx-auto flex max-w-6xl items-end gap-2">
          <Textarea
            aria-label={`Message ${agentName}`}
            className="min-h-12 resize-none bg-background shadow-none"
            disabled={sending}
            onChange={(event) => {
              const text = event.target.value;
              updateSession((current) => ({ ...current, draft: text }));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            onPaste={handlePaste}
            placeholder={`Message ${agentName}…`}
            rows={2}
            value={draft}
          />
          <Button
            aria-label="Send message"
            className="size-12 shrink-0"
            disabled={sending || (!draft.trim() && attachments.length === 0)}
            size="icon"
            type="submit"
          >
            {sending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Send aria-hidden="true" />
            )}
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-6xl truncate font-mono text-[10px] opacity-50">
          Sent through Herdr · Terminal stays available
        </p>
      </form>
    </section>
  );
}
