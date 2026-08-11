import { X } from 'lucide-react';
import {
  type ClipboardEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  ConversationTimeline,
  latestActivePlanStep,
  WorkingIndicator,
} from '@/renderer/chat/ConversationTimeline';
import {
  applyConversationChanged,
  applyConversationRead,
  type ConversationStore,
  createConversationStore,
  decodeConversationChangedEvent,
} from '@/renderer/chat/conversation-model';
import {
  acceptImageFiles,
  attachmentNoticeFor,
  type ChatAttachment,
  imageFiles,
  imageReference,
  readBlobAsBase64,
} from '@/renderer/chat/image-attachments';
import {
  filterSlashCommands,
  type SlashCommand,
  slashCommandsForAgent,
} from '@/renderer/chat/slash-commands';
import type {
  ConversationItem,
  ConversationReadResult,
  ConversationRespondResult,
} from '@/shared/conversation';
import type { HerdrEventEnvelope } from '@/shared/events';
import type { PaneInfo } from '@/shared/herdr';

interface ConversationChatPanelProps {
  pane: PaneInfo;
  onOpenTerminal?: () => void;
}

function itemText(store: ConversationStore): string {
  const lastTurn = [...store.items].reverse().find((item) => item.turn_id)?.turn_id;
  return lastTurn ?? '';
}

function eventForPane(event: HerdrEventEnvelope, paneId: string) {
  if (event.event !== 'agent.conversation_changed') {
    return null;
  }
  const changed = decodeConversationChangedEvent(event.data);
  return changed?.pane_id === paneId ? changed : null;
}

export function ConversationChatPanel({ pane, onOpenTerminal }: ConversationChatPanelProps) {
  const [store, setStore] = useState(() => createConversationStore(pane.pane_id));
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<readonly ChatAttachment[]>([]);
  const [attachmentNotice, setAttachmentNotice] = useState<string>();
  const [slashMenuSelectedIndex, setSlashMenuSelectedIndex] = useState(0);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const storeRef = useRef(store);
  const readQueueRef = useRef(Promise.resolve());
  const requestEpochRef = useRef(0);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const olderAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | undefined>(undefined);
  const slashMenuId = useId();
  storeRef.current = store;

  const addAttachments = useCallback((files: File[]) => {
    if (files.length === 0) {
      return;
    }
    setAttachments((current) => {
      const { accepted, skippedForCount, skippedForSize } = acceptImageFiles(files, current);
      const notice = attachmentNoticeFor(skippedForSize, skippedForCount, files.length);
      setAttachmentNotice(notice);
      return accepted.length > 0 ? [...current, ...accepted] : current;
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.url);
      }
      return current.filter((attachment) => attachment.id !== id);
    });
    setAttachmentNotice(undefined);
  }, []);

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
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (!types.includes('Files')) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  async function sha256Hex(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function uploadAttachment(attachment: ChatAttachment): Promise<string> {
    const data = await readBlobAsBase64(attachment.blob);
    const digest = await sha256Hex(attachment.blob);
    const { upload, chunk_size } = await window.herdr.conversation.attachment.begin({
      target: pane.pane_id,
      media_type: attachment.blob.type || `image/${attachment.extension}`,
      name: attachment.name,
      byte_size: attachment.blob.size,
      sha256_digest: digest,
    });
    try {
      // Four base64 characters encode three bytes; keep every chunk (and its
      // request line) well below the engine's 8 KiB chunk bound.
      const chunkChars = Math.min(chunk_size, 8 * 1024);
      const charsPerChunk = Math.floor(chunkChars / 3) * 4;
      let index = 0;
      for (let offset = 0; offset < data.length; offset += charsPerChunk) {
        await window.herdr.conversation.attachment.chunk({
          upload: upload.handle,
          index,
          data_base64: data.slice(offset, offset + charsPerChunk),
        });
        index += 1;
      }
      const staged = await window.herdr.conversation.attachment.finish({ upload: upload.handle });
      return staged.handle;
    } catch (reason) {
      await window.herdr.conversation.attachment
        .abort({ upload: upload.handle })
        .catch(() => undefined);
      throw reason;
    }
  }

  const read = useCallback(
    (direction: 'newest' | 'older' | 'newer', cursor?: string, epoch = requestEpochRef.current) => {
      const run = async () => {
        let requestedDirection = direction;
        let nextCursor = cursor;
        let lastResult: ConversationReadResult | undefined;
        for (;;) {
          if (epoch !== requestEpochRef.current) {
            return lastResult;
          }
          if (nextCursor === undefined && requestedDirection !== 'newest') {
            nextCursor =
              requestedDirection === 'newer'
                ? storeRef.current.newerCursor
                : storeRef.current.olderCursor;
          }
          const effectiveDirection =
            nextCursor === undefined && requestedDirection !== 'newest'
              ? 'newest'
              : requestedDirection;
          const result = await window.herdr.conversation.read({
            target: pane.pane_id,
            direction: effectiveDirection,
            ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
          });
          lastResult = result;
          if (epoch !== requestEpochRef.current) {
            return result;
          }
          setStore((current) => applyConversationRead(current, result, effectiveDirection));
          if (result.type === 'reset_required' && effectiveDirection !== 'newest') {
            requestedDirection = 'newest';
            nextCursor = undefined;
            continue;
          }
          if (
            effectiveDirection !== 'newer' ||
            result.type !== 'page' ||
            result.page.items.length === 0 ||
            result.page.next_cursor === undefined ||
            result.page.next_cursor === nextCursor
          ) {
            return result;
          }
          nextCursor = result.page.next_cursor;
        }
      };
      const queued = readQueueRef.current.then(run, run);
      readQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [pane.pane_id],
  );

  useEffect(() => {
    const epoch = ++requestEpochRef.current;
    readQueueRef.current = Promise.resolve();
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setStore(createConversationStore(pane.pane_id));
    void read('newest', undefined, epoch)
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Could not load conversation.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    void window.herdr.conversation.subscribe(pane.pane_id).catch(() => undefined);
    const unsubscribe = window.herdr.onSessionEvent((event) => {
      const changed = eventForPane(event, pane.pane_id);
      if (!changed) {
        return;
      }
      setStore((current) => applyConversationChanged(current, changed));
      void read(changed.reset_required ? 'newest' : 'newer').catch(() => undefined);
    });
    // Fallback live poll: subscription notifications can be missed during
    // engine restarts or subscription reconnects, and the engine's newer read
    // is cheap (metadata-only when nothing changed). This guarantees the chat
    // keeps streaming while the agent is working even if an event is dropped.
    const livePoll = window.setInterval(() => {
      if (
        paneRef.current.agent_status === 'working' ||
        paneRef.current.agent_status === 'blocked'
      ) {
        void read('newer').catch(() => undefined);
      }
    }, 1_500);
    return () => {
      cancelled = true;
      requestEpochRef.current += 1;
      window.clearInterval(livePoll);
      unsubscribe();
      void window.herdr.conversation.unsubscribe(pane.pane_id).catch(() => undefined);
    };
  }, [pane.pane_id, read]);

  const send = async (retry?: { id: string; text: string }) => {
    const text = retry?.text ?? draft.trim();
    if ((!text && attachments.length === 0) || sending) {
      return;
    }
    setSending(true);
    setError(undefined);
    const submitted = attachments;
    const pendingId = retry?.id ?? `pending:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    if (retry) {
      setStore((current) => ({
        ...current,
        pending: current.pending.map((pending) =>
          pending.id === pendingId ? { ...pending, status: 'queued' } : pending,
        ),
      }));
    } else if (text) {
      // Optimistic echo: the engine queues the prompt before Pi persists it,
      // so show the message immediately as queued instead of making the user
      // wait for the durable transcript.
      setStore((current) => ({
        ...current,
        pending: [...current.pending, { id: pendingId, text, status: 'queued' }],
      }));
      setDraft('');
    }
    try {
      const staged = await Promise.all(submitted.map((attachment) => uploadAttachment(attachment)));
      await window.herdr.conversation.prompt({
        target: pane.pane_id,
        text,
        ...(staged.length === 0 ? {} : { attachments: staged.map((handle) => ({ handle })) }),
      });
      if (text) {
        setStore((current) => ({
          ...current,
          pending: current.pending.map((pending) =>
            pending.id === pendingId ? { ...pending, status: 'syncing' } : pending,
          ),
        }));
      }
      for (const attachment of submitted) {
        URL.revokeObjectURL(attachment.url);
      }
      setAttachments([]);
      await read('newer', store.newerCursor);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Could not send prompt.');
      if (text) {
        setStore((current) => ({
          ...current,
          pending: current.pending.map((pending) =>
            pending.id === pendingId ? { ...pending, status: 'failed' } : pending,
          ),
        }));
      }
    } finally {
      setSending(false);
    }
  };

  const items = useMemo(() => store.items, [store.items]);

  // The currently open turn, pinned above the composer so the working state
  // stays visible no matter where the conversation is scrolled. The engine
  // guarantees at most one started turn at a time.
  const activeWork = useMemo(() => {
    let startedMs: number | undefined;
    let activeTurnId: string | undefined;
    for (const item of store.items) {
      if (item.type === 'turn_state' && item.state === 'started') {
        startedMs = item.started_ms;
        activeTurnId = item.turn_id;
      }
    }
    if (activeTurnId === undefined) {
      return null;
    }
    const turnItems = store.items.filter((item) => item.turn_id === activeTurnId);
    return { startedMs, activeStep: latestActivePlanStep(turnItems) };
  }, [store.items]);

  const respond = useCallback(
    async (
      approval: Extract<ConversationItem, { type: 'approval' }>,
      decisionId: string,
    ): Promise<ConversationRespondResult> => {
      const current = storeRef.current;
      if (!current.readerGeneration || !current.session) {
        throw new Error('Conversation identity changed. Refreshing…');
      }
      const result = await window.herdr.conversation.respond({
        target: pane.pane_id,
        reader_generation: current.readerGeneration,
        session: current.session,
        request_id: approval.request_id,
        decision_id: decisionId,
      });
      await read('newer');
      return result;
    },
    [pane.pane_id, read],
  );

  // Follow the latest items: new messages scroll the view to the bottom
  // automatically, unless the user has scrolled up to read history.
  const handleViewportScroll = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) {
      return;
    }
    const nearBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 64;
    followLatestRef.current = nearBottom;
  }, []);

  useLayoutEffect(() => {
    const viewport = scrollViewportRef.current;
    const anchor = olderAnchorRef.current;
    if (viewport && anchor) {
      viewport.scrollTop = anchor.scrollTop + viewport.scrollHeight - anchor.scrollHeight;
      olderAnchorRef.current = undefined;
      return;
    }
    if (!followLatestRef.current || items.length + store.pending.length === 0) {
      return;
    }
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [items, store.pending]);

  const loadOlder = useCallback(async () => {
    const viewport = scrollViewportRef.current;
    if (viewport) {
      olderAnchorRef.current = {
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      };
      followLatestRef.current = false;
    }
    try {
      await read('older', storeRef.current.olderCursor);
    } catch (reason) {
      olderAnchorRef.current = undefined;
      setError(reason instanceof Error ? reason.message : 'Could not load older history.');
    }
  }, [read]);

  const commandMenu = useMemo(() => {
    const trimmed = draft.trimStart();
    if (slashMenuDismissed || !trimmed.startsWith('/') || trimmed.includes(' ')) {
      return null;
    }
    const options = filterSlashCommands(slashCommandsForAgent(pane.agent ?? ''), trimmed.slice(1));
    return {
      options,
      selectedIndex: Math.min(slashMenuSelectedIndex, Math.max(0, options.length - 1)),
    };
  }, [draft, pane.agent, slashMenuDismissed, slashMenuSelectedIndex]);

  const selectSlashCommand = useCallback((command: SlashCommand) => {
    setDraft(`/${command.name}${command.takesArgument ? ' ' : ''}`);
    setSlashMenuDismissed(true);
  }, []);

  const capability = pane.conversation_capability;
  if (capability?.availability !== 'supported') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {capability?.message ?? 'Structured Chat is unavailable for this pane.'}
        </p>
        {onOpenTerminal ? (
          <Button type="button" variant="neutral" onClick={onOpenTerminal}>
            Open Terminal
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3" data-slot="conversation-chat">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{store.provider ?? pane.agent ?? 'Agent'} Chat</span>
        <span>{items.length} items</span>
      </div>
      {store.resetRequired ? (
        <div className="rounded-base border-2 border-border bg-secondary-background p-2 text-xs">
          Conversation changed. Reloading the current session…
        </div>
      ) : null}
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={scrollViewportRef}
        onViewportScroll={handleViewportScroll}
      >
        <div className="space-y-3 pr-3">
          {store.olderCursor ? (
            <Button
              type="button"
              className="w-full"
              variant="neutral"
              disabled={loading}
              onClick={() => void loadOlder()}
            >
              Load older history
            </Button>
          ) : null}
          {loading && items.length === 0 ? (
            <div className="text-sm text-muted-foreground">Loading conversation…</div>
          ) : null}
          <ConversationTimeline
            items={items}
            paneId={pane.pane_id}
            readerGeneration={store.readerGeneration}
            session={store.session}
            onOpenTerminal={onOpenTerminal}
            onRespond={respond}
          />
          {store.pending.map((pending) => (
            <div
              className="rounded-base border-2 border-dashed border-border bg-secondary-background p-3 text-sm opacity-70"
              data-slot="pending-message"
              key={pending.id}
            >
              <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground">
                <span>You</span>
                <span
                  className={cn(
                    'flex items-center gap-1 normal-case',
                    pending.status === 'failed' ? 'text-destructive' : 'text-main',
                  )}
                >
                  <span className="motion-safe:animate-pulse" aria-hidden="true">
                    ●
                  </span>
                  {pending.status === 'failed'
                    ? 'Failed'
                    : pending.status === 'syncing'
                      ? 'Syncing'
                      : 'Queued'}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words">{pending.text}</p>
              {pending.status === 'failed' ? (
                <Button
                  className="mt-2"
                  type="button"
                  variant="neutral"
                  disabled={sending}
                  onClick={() => {
                    followLatestRef.current = true;
                    void send(pending);
                  }}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ))}
          {!loading && items.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No structured conversation items yet.
            </div>
          ) : null}
        </div>
      </ScrollArea>
      {activeWork ? (
        <div className="shrink-0" data-slot="active-work">
          <WorkingIndicator startedMs={activeWork.startedMs} activeStep={activeWork.activeStep} />
        </div>
      ) : null}
      <form
        className="space-y-2 border-t-2 border-border pt-3"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onSubmit={(event) => {
          event.preventDefault();
          followLatestRef.current = true;
          void send();
        }}
      >
        {attachmentNotice ? (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {attachmentNotice}
          </p>
        ) : null}
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
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
                  className="size-7"
                  disabled={sending}
                  onClick={() => removeAttachment(attachment.id)}
                  size="icon"
                  variant="neutral"
                >
                  <X aria-hidden="true" />
                </Button>
              </article>
            ))}
          </div>
        ) : null}
        <div className="relative">
          {commandMenu ? (
            <div
              aria-label="Slash commands"
              className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-64 overflow-y-auto rounded-base border-2 border-border bg-background shadow-shadow"
              id={slashMenuId}
              role="listbox"
            >
              {commandMenu.options.length === 0 ? (
                <p className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                  No matching commands
                </p>
              ) : (
                commandMenu.options.map((command, index) => (
                  <button
                    aria-selected={index === commandMenu.selectedIndex}
                    className={cn(
                      'flex w-full items-baseline gap-2 px-3 py-1.5 text-left font-mono text-xs',
                      index === commandMenu.selectedIndex && 'bg-secondary-background',
                    )}
                    id={`${slashMenuId}-${command.name}`}
                    key={command.name}
                    onClick={() => selectSlashCommand(command)}
                    role="option"
                    type="button"
                  >
                    <span className="shrink-0 text-main">/{command.name}</span>
                    <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                      {command.description}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
          <Textarea
            aria-activedescendant={
              commandMenu?.options.length
                ? `${slashMenuId}-${commandMenu.options[commandMenu.selectedIndex].name}`
                : undefined
            }
            aria-autocomplete="list"
            aria-controls={commandMenu ? slashMenuId : undefined}
            aria-expanded={Boolean(commandMenu)}
            aria-haspopup="listbox"
            aria-label="Chat prompt"
            value={draft}
            disabled={sending}
            onChange={(event) => {
              setDraft(event.target.value);
              setSlashMenuSelectedIndex(0);
              setSlashMenuDismissed(false);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return;
              }
              if (commandMenu) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSlashMenuSelectedIndex((index) =>
                    Math.min(index + 1, commandMenu.options.length - 1),
                  );
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSlashMenuSelectedIndex((index) => Math.max(index - 1, 0));
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSlashMenuDismissed(true);
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey && commandMenu.options.length > 0) {
                  event.preventDefault();
                  selectSlashCommand(commandMenu.options[commandMenu.selectedIndex]);
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                followLatestRef.current = true;
                void send();
              }
            }}
            onPaste={handlePaste}
            placeholder="Message the agent… (Enter to send, Shift+Enter for a new line)"
            className={cn('min-h-20 resize-y')}
          />
        </div>
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={sending || (draft.trim().length === 0 && attachments.length === 0)}
          >
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </form>
      <span className="sr-only">Current turn: {itemText(store)}</span>
    </div>
  );
}
