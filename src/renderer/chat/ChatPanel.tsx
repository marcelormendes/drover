import { AlertTriangle, Bot, LoaderCircle, Send, SquareTerminal, User } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  advancePaneOutput,
  applyPaneRead,
  type ChatTranscriptMessage,
  createChatTranscript,
  extractPaneResponse,
  submitUserMessage,
} from '@/renderer/chat/transcript-model';
import type { HerdrQueryResult } from '@/shared/desktop-api';
import type { PaneInfo } from '@/shared/herdr';

export type PaneOutput = Extract<HerdrQueryResult, { type: 'pane-output' }>;

export interface ChatSessionState {
  readonly draft: string;
  readonly transcript: ReturnType<typeof createChatTranscript>;
  readonly output?: PaneOutput;
  readonly baselineRevision?: number;
  readonly baselineText?: string;
  readonly pollUntil?: number;
}

export function createChatSessionState(): ChatSessionState {
  return {
    draft: '',
    transcript: createChatTranscript(),
  };
}

export type ChatSessionUpdate = (current: ChatSessionState) => ChatSessionState;

interface ChatPanelProps {
  pane: PaneInfo;
  readOutput: (paneId: string) => Promise<PaneOutput>;
  onPrompt: (target: string, text: string) => void | Promise<void>;
  onOpenTerminal?: () => void;
  session?: ChatSessionState;
  onSessionChange?: (update: ChatSessionUpdate) => void;
}

const statusTone: Record<PaneInfo['agent_status'], string> = {
  working: 'bg-chart-1',
  blocked: 'bg-chart-2',
  done: 'bg-chart-4',
  idle: 'bg-secondary-background',
  unknown: 'bg-chart-3',
};

export function ChatPanel({
  pane,
  readOutput,
  onPrompt,
  onOpenTerminal,
  session: controlledSession,
  onSessionChange,
}: ChatPanelProps) {
  const agentName = pane.display_agent || pane.agent || 'Agent';
  const [internalSession, setInternalSession] = useState(createChatSessionState);
  const [refreshError, setRefreshError] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [sending, setSending] = useState(false);
  const submissionSequenceRef = useRef(0);
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

  useEffect(() => {
    let active = true;
    const refresh = async () => {
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
          const responseText =
            current.baselineText !== undefined && activePrompt
              ? extractPaneResponse(current.baselineText, nextOutput.text, activePrompt)
              : '';
          const nextTranscript = responseText
            ? applyPaneRead(current.transcript, {
                text: responseText,
                revision: nextOutput.revision,
                status: pane.agent_status,
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
      }
    };
    void refresh();
    const shouldPoll =
      pane.agent_status === 'working' ||
      Boolean(transcript.activeTurnId && (session.pollUntil ?? 0) > Date.now());
    let interval: number | undefined;
    if (shouldPoll) {
      interval = window.setInterval(() => {
        if (pane.agent_status !== 'working' && (session.pollUntil ?? 0) <= Date.now()) {
          if (interval !== undefined) {
            window.clearInterval(interval);
          }
          return;
        }
        void refresh();
      }, 1_000);
    }
    return () => {
      active = false;
      if (interval !== undefined) {
        window.clearInterval(interval);
      }
    };
  }, [
    pane.agent_status,
    pane.pane_id,
    readOutput,
    session.pollUntil,
    transcript.activeTurnId,
    updateSession,
  ]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) {
      return;
    }
    submissionSequenceRef.current += 1;
    const submissionId = `${pane.pane_id}:${Date.now()}:${submissionSequenceRef.current}`;
    updateSession((current) => ({
      ...current,
      draft: '',
      baselineRevision: current.output?.revision ?? 0,
      baselineText: current.output?.text ?? '',
      pollUntil: Date.now() + 30_000,
      transcript: submitUserMessage(current.transcript, { submissionId, text }),
    }));
    setSendError(false);
    setSending(true);
    try {
      await onPrompt(pane.pane_id, text);
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const messageCard = (message: ChatTranscriptMessage) =>
    message.role === 'user' ? (
      <article
        className="ml-6 rounded-base border-2 border-border bg-main p-4 shadow-shadow sm:ml-16"
        key={message.id}
      >
        <div className="mb-3 flex items-center gap-2 text-xs font-heading uppercase tracking-wide">
          <User aria-hidden="true" className="size-4" /> You
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
      </article>
    ) : (
      <article
        className="mr-6 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow sm:mr-16"
        key={message.id}
      >
        <div className="mb-3 flex items-center gap-2 text-xs font-heading uppercase tracking-wide">
          <Bot aria-hidden="true" className="size-4" /> {agentName}
          <Badge className="ml-auto capitalize" variant="neutral">
            {message.status}
          </Badge>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.text}</p>
      </article>
    );

  return (
    <section
      aria-label={`Chat with ${agentName}`}
      className="flex min-h-0 flex-1 flex-col bg-background"
    >
      <div className="flex shrink-0 items-center gap-3 border-b-2 border-border bg-secondary-background px-4 py-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-base border-2 border-border bg-main shadow-shadow">
          <Bot aria-hidden="true" className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-heading">{agentName}</h2>
          <p className="truncate text-[11px] opacity-65">{pane.label || pane.pane_id}</p>
        </div>
        <Badge className={cn('ml-auto shrink-0 capitalize', statusTone[pane.agent_status])}>
          {pane.agent_status === 'working' ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          {pane.agent_status}
        </Badge>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div
          aria-label={`Conversation with ${agentName}`}
          aria-live="polite"
          className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6"
          role="log"
        >
          {pane.agent_status === 'blocked' ? (
            <div className="flex items-center gap-3 rounded-base border-2 border-border bg-chart-2 p-3 shadow-shadow">
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
            <article className="mr-6 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow sm:mr-16">
              <div className="mb-3 flex items-center gap-2 text-xs font-heading uppercase tracking-wide">
                <Bot aria-hidden="true" className="size-4" /> Current {agentName} output
              </div>
              {output?.text ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-6">{output.text}</p>
              ) : (
                <p className="text-sm opacity-65">
                  Send a message to start working with this agent.
                </p>
              )}
              {output?.truncated ? (
                <p className="mt-3 border-t-2 border-border pt-2 text-xs opacity-65">
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
              className="mr-6 flex items-center gap-3 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow sm:mr-16"
            >
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              <p className="text-sm">Waiting for new agent output…</p>
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

      <form
        className="shrink-0 border-t-2 border-border bg-secondary-background p-3 sm:p-4"
        onSubmit={submit}
      >
        <div className="mx-auto flex max-w-4xl items-end gap-2">
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
            placeholder={`Message ${agentName}…`}
            rows={2}
            value={draft}
          />
          <Button
            aria-label="Send message"
            className="size-12 shrink-0"
            disabled={sending || !draft.trim()}
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
        <p className="mx-auto mt-2 max-w-4xl text-[11px] opacity-60">
          Sent through Herdr · Terminal remains available for interactive controls
        </p>
      </form>
    </section>
  );
}
