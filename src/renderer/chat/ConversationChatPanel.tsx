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
import { ConversationStatusStrip } from '@/renderer/chat/ConversationStatusStrip';
import {
  ConversationTimeline,
  latestPlanUpdate,
  PlanUpdateCard,
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
import {
  type ConversationItem,
  type ConversationReadResult,
  type ConversationRespondResult,
  isPreSessionConversationCapability,
} from '@/shared/conversation';
import type { HerdrEventEnvelope } from '@/shared/events';
import type { AgentInfo, PaneInfo } from '@/shared/herdr';
import droverIcon from '../../../resources/icon-1024.png';

interface ComposerState {
  draft: string;
  attachments: readonly ChatAttachment[];
  attachmentNotice?: string;
}

// Pane stages unmount during view, tab, and workspace navigation. Retain the
// rendered timeline and local composer state while the pane still exists.
const conversationStoreByPane = new Map<string, ConversationStore>();
const composerStateByPane = new Map<string, ComposerState>();
const workingStartedMsByPane = new Map<string, number>();
const sentAttachmentPreviewUrlsByPane = new Map<string, Set<string>>();
const CONVERSATION_READ_LIMIT = 256;
// Older pages issue two server cursors; refresh the live tail before either
// cursor can evict the current live cursor from the bounded registry.
const PLAN_HISTORY_REFRESH_INTERVAL = 32;
const PLAN_HYDRATION_RETRY_DELAY_MS = 500;
const PLAN_HYDRATION_MAX_RETRY_DELAY_MS = 5_000;
// Trailing coalesce window for "Load older history": clicks that keep arriving
// after an in-flight read resolves are folded into a single follow-up read so a
// hammered button never issues one read per click. Exported for tests.
export const LOAD_OLDER_COALESCE_MS = 300;

export function pruneConversationChatState(activePaneIds: readonly string[]): void {
  const active = new Set(activePaneIds);
  for (const [paneId, state] of composerStateByPane) {
    if (!active.has(paneId)) {
      for (const attachment of state.attachments) {
        URL.revokeObjectURL(attachment.url);
      }
      composerStateByPane.delete(paneId);
    }
  }
  for (const [paneId, sentPreviewUrls] of sentAttachmentPreviewUrlsByPane) {
    if (!active.has(paneId)) {
      for (const url of sentPreviewUrls) {
        URL.revokeObjectURL(url);
      }
      sentAttachmentPreviewUrlsByPane.delete(paneId);
    }
  }
  for (const paneId of conversationStoreByPane.keys()) {
    if (!active.has(paneId)) {
      conversationStoreByPane.delete(paneId);
    }
  }
  for (const paneId of workingStartedMsByPane.keys()) {
    if (!active.has(paneId)) {
      workingStartedMsByPane.delete(paneId);
    }
  }
}

interface ConversationChatPanelProps {
  pane: PaneInfo;
  agentReadiness?: Pick<AgentInfo, 'launch_pending' | 'interactive_ready'>;
  onOpenTerminal?: () => void;
  visible?: boolean;
}
function itemText(items: readonly ConversationItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const turnId = items[index]?.turn_id;
    if (turnId) {
      return turnId;
    }
  }
  return '';
}

function eventForPane(event: HerdrEventEnvelope, paneId: string) {
  if (event.event !== 'agent.conversation_changed') {
    return null;
  }
  const changed = decodeConversationChangedEvent(event.data);
  return changed?.pane_id === paneId ? changed : null;
}

function conversationPaneIdentity(pane: PaneInfo): string {
  return JSON.stringify([
    pane.pane_id,
    pane.agent,
    pane.conversation_session?.id,
    pane.agent_session?.source,
    pane.agent_session?.kind,
    pane.agent_session?.value,
  ]);
}

const PROVIDER_NAME_BY_AGENT: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  omp: 'Oh My Pi',
};

function isClaudeAdministrativeMessage(item: ConversationItem): boolean {
  if (item.provider !== 'claude' || item.type !== 'user_message') {
    return false;
  }
  const text = item.text.trimStart();
  return (
    text.startsWith('<command-name>') ||
    text.startsWith('<local-command-stdout>') ||
    text.startsWith('<local-command-stderr>')
  );
}

function stripAnsiSgr(value: string): string {
  let plainText = '';
  let index = 0;
  while (index < value.length) {
    if (value.charCodeAt(index) === 27 && value[index + 1] === '[') {
      let end = index + 2;
      while (
        end < value.length &&
        ((value.charCodeAt(end) >= 48 && value.charCodeAt(end) <= 57) || value[end] === ';')
      ) {
        end += 1;
      }
      if (value[end] === 'm') {
        index = end + 1;
        continue;
      }
    }
    plainText += value[index];
    index += 1;
  }
  return plainText;
}

function selectedModel(pane: PaneInfo, items: readonly ConversationItem[]): string {
  const reported =
    pane.tokens?.model ||
    pane.tokens?.model_name ||
    pane.state_labels?.model ||
    pane.state_labels?.model_name;
  if (reported) {
    return reported;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item.provider !== 'claude' ||
      item.type !== 'user_message' ||
      !item.text.trimStart().startsWith('<local-command-stdout>')
    ) {
      continue;
    }
    const plainText = stripAnsiSgr(item.text);
    const selected = plainText.match(/Set model to\s+(.+?)\s+and saved/i)?.[1]?.trim();
    if (selected) {
      return selected;
    }
  }
  return 'Provider default';
}

function ProviderWelcome({ pane, items }: { pane: PaneInfo; items: readonly ConversationItem[] }) {
  const provider =
    pane.display_agent || PROVIDER_NAME_BY_AGENT[pane.agent?.toLowerCase() || ''] || pane.agent;
  const cwd = pane.foreground_cwd || pane.cwd || 'Not reported';
  return (
    <section className="grid min-h-full place-items-center px-4 py-8" data-slot="provider-welcome">
      <div className="w-full max-w-lg rounded-base border-2 border-border bg-secondary-background p-6 shadow-shadow">
        <img src={droverIcon} alt="Drover" className="mx-auto mb-4 size-16 object-contain" />
        <div className="text-center">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Drover
          </p>
          <h2 className="mt-1 text-xl font-heading">{provider || 'Agent'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Start the conversation here. Terminal remains available at any time.
          </p>
        </div>
        <dl className="mt-6 grid gap-3 text-sm">
          <div className="grid gap-1 rounded-base border-2 border-border bg-background p-3">
            <dt className="font-bold">Model</dt>
            <dd className="break-words font-mono text-xs text-muted-foreground">
              {selectedModel(pane, items)}
            </dd>
          </div>
          <div className="grid gap-1 rounded-base border-2 border-border bg-background p-3">
            <dt className="font-bold">Working directory</dt>
            <dd className="break-all font-mono text-xs text-muted-foreground">{cwd}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function ConversationChatPanel(props: ConversationChatPanelProps) {
  return <ConversationChatPanelForPane key={props.pane.pane_id} {...props} />;
}

function ConversationChatPanelForPane({
  pane,
  agentReadiness,
  onOpenTerminal,
  visible = true,
}: ConversationChatPanelProps) {
  const cachedStore = conversationStoreByPane.get(pane.pane_id);
  const savedStore =
    cachedStore?.session?.id === pane.conversation_session?.id ? cachedStore : undefined;
  const savedComposer = composerStateByPane.get(pane.pane_id);
  const [store, setStore] = useState(() => savedStore ?? createConversationStore(pane.pane_id));
  const [draft, setDraft] = useState(savedComposer?.draft ?? '');
  const [attachments, setAttachments] = useState<readonly ChatAttachment[]>(
    savedComposer?.attachments ?? [],
  );
  const [attachmentNotice, setAttachmentNotice] = useState<string | undefined>(
    savedComposer?.attachmentNotice,
  );
  const [slashMenuSelectedIndex, setSlashMenuSelectedIndex] = useState(0);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const [loading, setLoading] = useState(savedStore === undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [planHydrationRetry, setPlanHydrationRetry] = useState(0);
  const paneIdentity = conversationPaneIdentity(pane);
  const readCapabilityIdentityRef = useRef(savedStore ? paneIdentity : undefined);
  const workingIdentityRef = useRef(paneIdentity);
  const paneCapability = pane.conversation_capability;
  const paneConversationReadable = paneCapability?.availability === 'supported';
  const canProbeConversation =
    paneConversationReadable || isPreSessionConversationCapability(paneCapability);
  // A successful read is newer evidence than the pane snapshot that was
  // captured before the provider created its first transcript.
  const discoveredSessionMatches =
    readCapabilityIdentityRef.current === paneIdentity &&
    (!pane.conversation_session || pane.conversation_session.id === store.session?.id) &&
    (!pane.agent || pane.agent.toLowerCase() === store.provider);
  const capability =
    isPreSessionConversationCapability(paneCapability) &&
    discoveredSessionMatches &&
    store.capability?.availability === 'supported'
      ? store.capability
      : paneCapability;
  const preSessionChat = isPreSessionConversationCapability(capability);
  const conversationReadable = capability?.availability === 'supported';
  const planHistorySupported = pane.agent?.toLowerCase() !== 'claude';
  const paneWorking = pane.agent_status === 'working';
  const agentStarting = agentReadiness?.launch_pending === true;
  const agentNeedsSetup =
    !agentStarting && preSessionChat && agentReadiness?.interactive_ready === false && !paneWorking;
  const promptBlocked = agentStarting || agentNeedsSetup;
  const readinessMessage = agentStarting
    ? 'Agent is starting. Chat will be ready when launch completes.'
    : agentNeedsSetup
      ? 'The agent is not ready for prompts. Open Terminal to finish startup.'
      : preSessionChat
        ? store.pending.some((pending) => pending.status === 'syncing')
          ? 'Prompt sent, but no conversation transcript is available yet. Open Terminal to check the agent.'
          : 'No conversation transcript yet. Your first prompt will start the conversation.'
        : undefined;
  const [statusStartedMs, setStatusStartedMs] = useState<number | undefined>(() =>
    workingStartedMsByPane.get(pane.pane_id),
  );
  const paneRef = useRef(pane);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  paneRef.current = pane;
  const storeRef = useRef(store);
  const readQueueRef = useRef(Promise.resolve());
  const requestEpochRef = useRef(0);
  const planBoundaryKnownRef = useRef(
    savedStore?.items.some((item) => item.type === 'plan_update') ?? false,
  );
  const planHydrationPromiseRef = useRef<Promise<boolean> | undefined>(undefined);
  const pollInFlightRef = useRef(false);
  const loadingOlderRef = useRef(false);
  // Coalescing bookkeeping for "Load older history": any click while an older
  // read is in flight (or while a follow-up is already scheduled) is folded into
  // a single trailing read rather than issuing one read per click.
  const pendingOlderLoadRef = useRef(false);
  const olderDebounceTimerRef = useRef<number | undefined>(undefined);
  const pendingRefreshRevisionRef = useRef<number | undefined>(undefined);
  const pendingPayloadDrainRef = useRef(false);
  const planHydrationRetryRef = useRef(0);
  const planHydrationRetryTimerRef = useRef<number | undefined>(undefined);
  const planHydrationAllowedRef = useRef(false);
  const wasVisibleRef = useRef(visible);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const [olderAnchor, setOlderAnchor] = useState<{ scrollHeight: number; scrollTop: number }>();
  const slashMenuId = useId();
  const updateStore = useCallback((update: (current: ConversationStore) => ConversationStore) => {
    // Queued reads can settle before React commits. Advance their shared cursor
    // immediately so the next request does not replay the page just received.
    const next = update(storeRef.current);
    storeRef.current = next;
    setStore(next);
  }, []);
  const composerStateRef = useRef<ComposerState>({
    draft,
    attachments,
    attachmentNotice,
  });
  composerStateRef.current = { draft, attachments, attachmentNotice };

  useEffect(
    () => () => {
      composerStateByPane.set(pane.pane_id, composerStateRef.current);
      conversationStoreByPane.set(pane.pane_id, storeRef.current);
    },
    [pane.pane_id],
  );

  useEffect(() => {
    const ownedUrls = sentAttachmentPreviewUrlsByPane.get(pane.pane_id);
    if (!ownedUrls) {
      return;
    }
    const retainedUrls = new Set<string>();
    for (const pending of store.pending) {
      for (const attachment of pending.attachments ?? []) {
        retainedUrls.add(attachment.preview_url);
      }
    }
    for (const item of store.items) {
      if (item.type !== 'user_message') {
        continue;
      }
      for (const attachment of item.attachments ?? []) {
        if (attachment.preview_url) {
          retainedUrls.add(attachment.preview_url);
        }
      }
    }
    for (const url of ownedUrls) {
      if (!retainedUrls.has(url)) {
        URL.revokeObjectURL(url);
        ownedUrls.delete(url);
      }
    }
    if (ownedUrls.size === 0) {
      sentAttachmentPreviewUrlsByPane.delete(pane.pane_id);
    }
  }, [pane.pane_id, store.items, store.pending]);

  useEffect(() => {
    if (workingIdentityRef.current !== paneIdentity) {
      workingStartedMsByPane.delete(pane.pane_id);
      workingIdentityRef.current = paneIdentity;
    }
    if (!paneWorking) {
      workingStartedMsByPane.delete(pane.pane_id);
      setStatusStartedMs(undefined);
      return;
    }
    const startedMs = workingStartedMsByPane.get(pane.pane_id) ?? Date.now();
    workingStartedMsByPane.set(pane.pane_id, startedMs);
    setStatusStartedMs(startedMs);
  }, [pane.pane_id, paneIdentity, paneWorking]);

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
  const wakePlanHydration = useCallback(() => {
    queueMicrotask(() => {
      if (
        planHydrationAllowedRef.current &&
        planHydrationPromiseRef.current === undefined &&
        !pendingPayloadDrainRef.current &&
        !planBoundaryKnownRef.current &&
        storeRef.current.olderCursor !== undefined
      ) {
        if (planHydrationRetryTimerRef.current !== undefined) {
          window.clearTimeout(planHydrationRetryTimerRef.current);
          planHydrationRetryTimerRef.current = undefined;
        }
        setPlanHydrationRetry((retry) => retry + 1);
      }
    });
  }, []);

  const read = useCallback(
    (direction: 'newest' | 'older' | 'newer', cursor?: string, epoch = requestEpochRef.current) => {
      const run = async () => {
        let requestedDirection = direction;
        // Plan backfill and the history button share this queue. Resolve the
        // history boundary when the request starts, after earlier reads apply.
        let nextCursor = direction === 'older' ? storeRef.current.olderCursor : cursor;
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
          if (requestedDirection === 'older' && nextCursor === undefined) {
            return lastResult;
          }
          const effectiveDirection =
            nextCursor === undefined && requestedDirection !== 'newest'
              ? 'newest'
              : requestedDirection;
          if (effectiveDirection !== 'older') {
            pendingPayloadDrainRef.current = true;
          }
          const requestedPaneIdentity = conversationPaneIdentity(paneRef.current);
          const result = await window.herdr.conversation.read({
            target: pane.pane_id,
            direction: effectiveDirection,
            limit: CONVERSATION_READ_LIMIT,
            ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
          });
          lastResult = result;
          if (
            epoch !== requestEpochRef.current ||
            requestedPaneIdentity !== conversationPaneIdentity(paneRef.current)
          ) {
            return result;
          }
          if (result.type === 'page') {
            readCapabilityIdentityRef.current = requestedPaneIdentity;
          }
          if (result.type === 'reset_required') {
            planBoundaryKnownRef.current = false;
          } else if (result.page.items.some((item) => item.type === 'plan_update')) {
            planBoundaryKnownRef.current = true;
          } else if (effectiveDirection === 'newest') {
            planBoundaryKnownRef.current = false;
          }
          if (effectiveDirection === 'older' && result.type === 'page') {
            const viewport = scrollViewportRef.current;
            // Capture the current viewport only once the queued history read
            // returns: live output or user scrolling may have moved it meanwhile.
            if (viewport && !followLatestRef.current) {
              setOlderAnchor({
                scrollHeight: viewport.scrollHeight,
                scrollTop: viewport.scrollTop,
              });
            }
          }
          updateStore((current) => applyConversationRead(current, result, effectiveDirection));
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
            if (result.type === 'page' && effectiveDirection !== 'older') {
              pendingPayloadDrainRef.current = false;
              planHydrationRetryRef.current = 0;
              const pendingRevision = pendingRefreshRevisionRef.current;
              if (pendingRevision !== undefined && result.page.revision >= pendingRevision) {
                pendingRefreshRevisionRef.current = undefined;
              }
              wakePlanHydration();
            }
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
    [pane.pane_id, updateStore, wakePlanHydration],
  );
  const hydratePlanHistory = useCallback(async (): Promise<boolean> => {
    const epoch = requestEpochRef.current;
    let cursor = storeRef.current.olderCursor;
    const seenCursors = new Set<string>();
    let pagesRead = 0;
    while (
      cursor !== undefined &&
      !seenCursors.has(cursor) &&
      !planBoundaryKnownRef.current &&
      planHydrationAllowedRef.current &&
      !pendingPayloadDrainRef.current
    ) {
      seenCursors.add(cursor);
      pagesRead += 1;
      const result = await read('older', cursor, epoch);
      if (result?.type !== 'page') {
        return false;
      }
      cursor = result.page.has_older ? result.page.previous_cursor : undefined;
      if (
        cursor !== undefined &&
        pagesRead % PLAN_HISTORY_REFRESH_INTERVAL === 0 &&
        planHydrationAllowedRef.current &&
        !pendingPayloadDrainRef.current &&
        !planBoundaryKnownRef.current
      ) {
        const refreshed = await read('newest', undefined, epoch);
        if (refreshed?.type !== 'page') {
          return false;
        }
      }
    }
    if (
      cursor === undefined &&
      !planBoundaryKnownRef.current &&
      epoch === requestEpochRef.current
    ) {
      planBoundaryKnownRef.current = true;
    }
    return (
      cursor !== undefined &&
      !planBoundaryKnownRef.current &&
      (!planHydrationAllowedRef.current || pendingPayloadDrainRef.current)
    );
  }, [read]);
  const pollConversation = useCallback(async () => {
    if (pollInFlightRef.current) {
      return;
    }
    pollInFlightRef.current = true;
    const epoch = requestEpochRef.current;
    try {
      const metadata = window.herdr.conversation.metadata;
      if (typeof metadata !== 'function') {
        await read('newer', undefined, epoch);
        return;
      }
      let result: ConversationReadResult;
      try {
        result = await metadata({ target: pane.pane_id });
      } catch {
        if (epoch !== requestEpochRef.current) {
          return;
        }
        if (
          !isPreSessionConversationCapability(paneRef.current.conversation_capability) ||
          (storeRef.current.capability?.availability === 'supported' &&
            readCapabilityIdentityRef.current === conversationPaneIdentity(paneRef.current))
        ) {
          await read('newer', undefined, epoch);
        }
        return;
      }
      if (epoch !== requestEpochRef.current) {
        return;
      }
      const current = storeRef.current;
      const needsRefresh =
        readCapabilityIdentityRef.current !== conversationPaneIdentity(paneRef.current) ||
        result.type === 'reset_required' ||
        pendingRefreshRevisionRef.current !== undefined ||
        pendingPayloadDrainRef.current ||
        current.resetRequired ||
        current.readerGeneration !== result.page.reader_generation ||
        current.session?.id !== result.page.session.id ||
        result.page.revision !== current.revision;
      if (needsRefresh) {
        await read(result.type === 'reset_required' ? 'newest' : 'newer', undefined, epoch);
      }
    } finally {
      pollInFlightRef.current = false;
    }
  }, [pane.pane_id, read]);

  useEffect(() => {
    const epoch = ++requestEpochRef.current;
    readQueueRef.current = Promise.resolve();
    let cancelled = false;
    if (readCapabilityIdentityRef.current !== paneIdentity) {
      updateStore(() => createConversationStore(pane.pane_id));
    }
    const initialCursor = storeRef.current.newerCursor;
    const initialDirection = initialCursor === undefined ? 'newest' : 'newer';
    setLoading(paneConversationReadable && storeRef.current.items.length === 0);
    setError(undefined);
    if (paneConversationReadable) {
      void read(initialDirection, initialCursor, epoch)
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
    } else if (
      canProbeConversation &&
      visibleRef.current &&
      typeof window.herdr.conversation.metadata === 'function'
    ) {
      void pollConversation().catch(() => undefined);
    }
    void window.herdr.conversation.subscribe(pane.pane_id).catch(() => undefined);
    const unsubscribe = window.herdr.onSessionEvent((event) => {
      const changed = eventForPane(event, pane.pane_id);
      if (!changed) {
        return;
      }
      updateStore((current) => applyConversationChanged(current, changed));
      pendingRefreshRevisionRef.current = changed.reset_required
        ? 0
        : Math.max(pendingRefreshRevisionRef.current ?? 0, changed.revision);
      void read(changed.reset_required ? 'newest' : 'newer').catch(() => undefined);
    });
    // Poll metadata only while Chat is visible. A changed revision triggers
    // the cursor-based payload read; unchanged metadata must not churn cursors.
    const livePoll = window.setInterval(() => {
      if (
        visibleRef.current &&
        (paneRef.current.conversation_capability?.availability === 'supported' ||
          isPreSessionConversationCapability(paneRef.current.conversation_capability))
      ) {
        void pollConversation().catch(() => undefined);
      }
    }, 1_500);
    return () => {
      cancelled = true;
      requestEpochRef.current += 1;
      planHydrationAllowedRef.current = false;
      if (planHydrationRetryTimerRef.current !== undefined) {
        window.clearTimeout(planHydrationRetryTimerRef.current);
        planHydrationRetryTimerRef.current = undefined;
      }
      window.clearInterval(livePoll);
      unsubscribe();
      void window.herdr.conversation.unsubscribe(pane.pane_id).catch(() => undefined);
    };
  }, [
    canProbeConversation,
    paneConversationReadable,
    pane.pane_id,
    paneIdentity,
    pollConversation,
    read,
    updateStore,
  ]);
  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!wasVisible && visible && canProbeConversation) {
      void pollConversation().catch(() => undefined);
    }
  }, [canProbeConversation, pollConversation, visible]);

  const send = async (retry?: { id: string; text: string }) => {
    const text = retry?.text ?? draft.trim();
    if ((!text && attachments.length === 0) || sending || promptBlocked) {
      return;
    }
    const submittedStartedMs = workingStartedMsByPane.get(pane.pane_id) ?? Date.now();
    workingStartedMsByPane.set(pane.pane_id, submittedStartedMs);
    setStatusStartedMs(submittedStartedMs);
    setSending(true);
    setError(undefined);
    const submitted = attachments;
    const submittedPreviews = submitted.map((attachment) => ({
      media_type: attachment.blob.type || `image/${attachment.extension}`,
      name: attachment.name,
      preview_url: attachment.url,
    }));
    const pendingId = retry?.id ?? `pending:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    if (retry) {
      updateStore((current) => ({
        ...current,
        pending: current.pending.map((pending) =>
          pending.id === pendingId ? { ...pending, status: 'queued' } : pending,
        ),
      }));
    } else {
      // Optimistic echo: the engine queues the prompt before Pi persists it,
      // so show the message and image previews immediately as queued.
      updateStore((current) => ({
        ...current,
        pending: [
          ...current.pending,
          {
            id: pendingId,
            text,
            status: 'queued',
            ...(submittedPreviews.length === 0 ? {} : { attachments: submittedPreviews }),
          },
        ],
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
      updateStore((current) => ({
        ...current,
        pending: current.pending.map((pending) =>
          pending.id === pendingId ? { ...pending, status: 'syncing' } : pending,
        ),
      }));
      if (submittedPreviews.length > 0) {
        const ownedUrls = sentAttachmentPreviewUrlsByPane.get(pane.pane_id) ?? new Set<string>();
        for (const attachment of submittedPreviews) {
          ownedUrls.add(attachment.preview_url);
        }
        sentAttachmentPreviewUrlsByPane.set(pane.pane_id, ownedUrls);
      }
      composerStateByPane.set(pane.pane_id, {
        draft: '',
        attachments: [],
        attachmentNotice: undefined,
      });
      setAttachments([]);
      if (
        paneRef.current.conversation_capability?.availability === 'supported' ||
        (storeRef.current.capability?.availability === 'supported' &&
          readCapabilityIdentityRef.current === conversationPaneIdentity(paneRef.current))
      ) {
        await read('newer', store.newerCursor);
      } else if (typeof window.herdr.conversation.metadata === 'function') {
        void pollConversation().catch(() => undefined);
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Could not send prompt.');
      if (text) {
        updateStore((current) => ({
          ...current,
          pending: current.pending.map((pending) =>
            pending.id === pendingId ? { ...pending, status: 'failed' } : pending,
          ),
        }));
      }
      if (paneRef.current.agent_status !== 'working') {
        workingStartedMsByPane.delete(pane.pane_id);
        setStatusStartedMs(undefined);
      }
    } finally {
      setSending(false);
    }
  };

  const items = useMemo(
    () => store.items.filter((item) => !isClaudeAdministrativeMessage(item)),
    [store.items],
  );

  // Native turn events win when available. Claude can report pane Working
  // before its transcript exposes a started turn, so pane state fills only
  // that gap and never overrides a settled latest turn without new activity.
  const activeWork = useMemo(() => {
    if (agentStarting || (!conversationReadable && !paneWorking)) {
      return null;
    }
    const plan = latestPlanUpdate(store.items);
    let latestState: Extract<ConversationItem, { type: 'turn_state' }> | undefined;
    let latestStateIndex = -1;
    for (let index = store.items.length - 1; index >= 0; index -= 1) {
      const item = store.items[index];
      if (item.type === 'turn_state') {
        latestState = item;
        latestStateIndex = index;
        break;
      }
    }
    const runningTool = store.items.some(
      (item) => item.type === 'tool_activity' && item.status === 'running',
    );
    // A provider can leave a tool in `running` when its terminal event is
    // missed, so a settled latest turn must not stay pinned on a stale tool.
    const latestTurnSettled =
      latestState !== undefined &&
      (latestState.state === 'completed' ||
        latestState.state === 'interrupted' ||
        latestState.state === 'failed');
    if (latestState?.state === 'started') {
      let finalAnswerReceived = false;
      for (let index = latestStateIndex + 1; index < store.items.length; index += 1) {
        const item = store.items[index];
        if (
          item.type === 'assistant_message' &&
          item.phase === 'final' &&
          item.turn_id === latestState.turn_id
        ) {
          finalAnswerReceived = true;
          break;
        }
      }
      if (!finalAnswerReceived) {
        return {
          startedMs: latestState.started_ms ?? statusStartedMs,
          plan,
        };
      }
    }
    const pendingTurn = store.pending.some((pending) => pending.status !== 'failed');
    if (
      sending ||
      store.pending.some((pending) => pending.status === 'queued') ||
      (pendingTurn && paneWorking)
    ) {
      return {
        startedMs: statusStartedMs,
        plan,
      };
    }
    if (runningTool && !latestTurnSettled) {
      return {
        startedMs: statusStartedMs,
        plan,
      };
    }
    let activeTurnId: string | undefined;
    let activeUserIndex = -1;
    for (let index = store.items.length - 1; index > latestStateIndex; index -= 1) {
      const item = store.items[index];
      if (
        item.type === 'user_message' &&
        !isClaudeAdministrativeMessage(item) &&
        !item.text.trimStart().startsWith('<task-notification>') &&
        item.turn_id !== latestState?.turn_id
      ) {
        activeTurnId = item.turn_id;
        activeUserIndex = index;
        break;
      }
    }
    const activeTurnAnswered =
      activeUserIndex >= 0 &&
      store.items
        .slice(activeUserIndex + 1)
        .some(
          (item) =>
            item.type === 'assistant_message' &&
            item.phase === 'final' &&
            item.turn_id === activeTurnId,
        );
    if (
      !paneWorking &&
      (activeTurnAnswered || activeTurnId === undefined || statusStartedMs === undefined)
    ) {
      return null;
    }
    if (latestState && !pendingTurn && !activeTurnId) {
      return null;
    }
    return {
      startedMs: statusStartedMs,
      plan,
    };
  }, [
    agentStarting,
    conversationReadable,
    paneWorking,
    sending,
    statusStartedMs,
    store.items,
    store.pending,
  ]);
  const hasActiveWork = activeWork !== null;
  useEffect(() => {
    if (
      !hasActiveWork &&
      !paneWorking &&
      !sending &&
      !store.pending.some((pending) => pending.status !== 'failed') &&
      statusStartedMs !== undefined
    ) {
      workingStartedMsByPane.delete(pane.pane_id);
      setStatusStartedMs(undefined);
    }
  }, [hasActiveWork, pane.pane_id, paneWorking, sending, statusStartedMs, store.pending]);
  useEffect(() => {
    const canHydrate = visible && planHistorySupported && conversationReadable && hasActiveWork;
    const wasAllowed = planHydrationAllowedRef.current;
    if (!canHydrate) {
      planHydrationAllowedRef.current = false;
      planHydrationRetryRef.current = 0;
    } else {
      if (!wasAllowed) {
        planHydrationRetryRef.current = 0;
      }
      planHydrationAllowedRef.current = true;
    }
    void planHydrationRetry;
    const clearRetryTimer = () => {
      if (planHydrationRetryTimerRef.current !== undefined) {
        window.clearTimeout(planHydrationRetryTimerRef.current);
        planHydrationRetryTimerRef.current = undefined;
      }
    };
    if (
      !canHydrate ||
      planBoundaryKnownRef.current ||
      planHydrationPromiseRef.current !== undefined ||
      store.olderCursor === undefined
    ) {
      if (!canHydrate || planBoundaryKnownRef.current || store.olderCursor === undefined) {
        clearRetryTimer();
      }
      return;
    }
    const scheduleRetry = () => {
      if (!planHydrationAllowedRef.current || planHydrationRetryTimerRef.current !== undefined) {
        return;
      }
      const attempt = Math.min(planHydrationRetryRef.current, 4);
      planHydrationRetryRef.current = attempt + 1;
      const delay = Math.min(
        PLAN_HYDRATION_RETRY_DELAY_MS * 2 ** attempt,
        PLAN_HYDRATION_MAX_RETRY_DELAY_MS,
      );
      planHydrationRetryTimerRef.current = window.setTimeout(() => {
        planHydrationRetryTimerRef.current = undefined;
        if (planHydrationAllowedRef.current) {
          setPlanHydrationRetry((retry) => retry + 1);
        }
      }, delay);
    };
    let failed = false;
    const hydration = hydratePlanHistory().catch(() => {
      failed = true;
      scheduleRetry();
      return false;
    });
    planHydrationPromiseRef.current = hydration;
    void hydration.then((paused) => {
      if (planHydrationPromiseRef.current === hydration) {
        planHydrationPromiseRef.current = undefined;
        if (!failed) {
          planHydrationRetryRef.current = 0;
          if (paused) {
            wakePlanHydration();
          }
        }
      }
    });
  }, [
    conversationReadable,
    hasActiveWork,
    hydratePlanHistory,
    planHistorySupported,
    planHydrationRetry,
    wakePlanHydration,
    store.olderCursor,
    visible,
  ]);

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
    const anchor = olderAnchor;
    if (viewport && anchor) {
      viewport.scrollTop = anchor.scrollTop + viewport.scrollHeight - anchor.scrollHeight;
      setOlderAnchor(undefined);
      return;
    }
    if (!viewport || !followLatestRef.current || items.length + store.pending.length === 0) {
      return;
    }

    const scrollToLatest = () => {
      if (scrollViewportRef.current === viewport && followLatestRef.current) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    };
    // Scroll immediately and once more on the next frame so a freshly committed
    // items batch settles into place; one rAF per committed batch, not per item.
    scrollToLatest();
    const frame = window.requestAnimationFrame(scrollToLatest);
    return () => window.cancelAnimationFrame(frame);
  }, [olderAnchor, items, store.pending]);

  // Follow-latest scroll accompaniment: keep the observer attached for the life
  // of the content element instead of tearing it down and recreating it on every
  // items/pending identity change (which is what made rapid "Load older history"
  // clicks churn the layout and flicker).
  useLayoutEffect(() => {
    const viewport = scrollViewportRef.current;
    const content = viewport?.firstElementChild;
    if (!viewport || !content || typeof ResizeObserver === 'undefined') {
      return;
    }
    const scrollToLatest = () => {
      if (scrollViewportRef.current === viewport && followLatestRef.current) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    };
    const observer = new ResizeObserver(scrollToLatest);
    observer.observe(content);
    return () => observer.disconnect();
    // The viewport content element is stable for the panel's lifetime; re-keying
    // on items identity would recreate the observer on every commit.
  }, []);

  const loadOlder = useCallback(async () => {
    // Ignore clicks when there is no recorded older page to fetch.
    if (storeRef.current.olderCursor === undefined) {
      return;
    }
    // While a read is in flight or a coalesced follow-up is already scheduled,
    // fold the click into a single trailing read instead of one read per click.
    if (loadingOlderRef.current || olderDebounceTimerRef.current !== undefined) {
      pendingOlderLoadRef.current = true;
      return;
    }
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const viewport = scrollViewportRef.current;
    if (viewport) {
      followLatestRef.current = false;
    }
    try {
      setError(undefined);
      await read('older');
    } catch (reason) {
      setOlderAnchor(undefined);
      setError(reason instanceof Error ? reason.message : 'Could not load older history.');
    } finally {
      loadingOlderRef.current = false;
      // Open a short trailing coalesce window after EVERY older read settles.
      // Residual clicks that were queued while the read was in flight (and land
      // after it resolves, or during this window) fold into a single follow-up,
      // so a hammered button never issues one read per click. When the window
      // closes with no further clicks, the button finally re-enables.
      if (olderDebounceTimerRef.current === undefined) {
        olderDebounceTimerRef.current = window.setTimeout(() => {
          olderDebounceTimerRef.current = undefined;
          if (pendingOlderLoadRef.current && storeRef.current.olderCursor !== undefined) {
            pendingOlderLoadRef.current = false;
            void loadOlder();
          } else {
            pendingOlderLoadRef.current = false;
            setLoadingOlder(false);
          }
        }, LOAD_OLDER_COALESCE_MS);
      }
    }
  }, [read]);

  // Drop any pending coalesce timer on unmount so a payload is never scheduled
  // against a detached panel.
  useEffect(
    () => () => {
      if (olderDebounceTimerRef.current !== undefined) {
        window.clearTimeout(olderDebounceTimerRef.current);
      }
    },
    [],
  );

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

  if (capability?.availability !== 'supported' && !preSessionChat) {
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
        <span>
          {pane.display_agent ||
            PROVIDER_NAME_BY_AGENT[pane.agent?.toLowerCase() || ''] ||
            store.provider ||
            pane.agent ||
            'Agent'}{' '}
          Chat
        </span>
        <span>{items.length} items</span>
      </div>
      {readinessMessage ? (
        <div
          className="rounded-base border-2 border-border bg-secondary-background p-3 text-sm"
          data-slot="chat-readiness"
        >
          <p>{readinessMessage}</p>
          {onOpenTerminal ? (
            <Button className="mt-2" type="button" variant="neutral" onClick={onOpenTerminal}>
              Open Terminal
            </Button>
          ) : null}
        </div>
      ) : null}
      {store.resetRequired ? (
        <div className="rounded-base border-2 border-border bg-secondary-background p-2 text-xs">
          Conversation changed. Reloading the current session…
        </div>
      ) : null}
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
      <ScrollArea
        className="min-h-0 flex-1 [overflow-anchor:none]"
        viewportRef={scrollViewportRef}
        onViewportScroll={handleViewportScroll}
      >
        <div className="space-y-3 pr-3">
          {store.olderCursor ? (
            <Button
              type="button"
              className="w-full"
              variant="neutral"
              disabled={loading || loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? 'Loading older history…' : 'Load older history'}
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
                  <span
                    className={conversationReadable ? 'motion-safe:animate-pulse' : undefined}
                    aria-hidden="true"
                  >
                    ●
                  </span>
                  {pending.status === 'failed'
                    ? 'Failed'
                    : pending.status === 'syncing'
                      ? conversationReadable
                        ? 'Syncing'
                        : 'Sent · transcript unavailable'
                      : 'Queued'}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words">{pending.text}</p>
              {pending.attachments?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {pending.attachments.map((attachment) => (
                    <img
                      alt={`Attached image: ${attachment.name}`}
                      className="size-16 rounded-base border-2 border-border object-cover"
                      key={attachment.preview_url}
                      src={attachment.preview_url}
                    />
                  ))}
                </div>
              ) : null}
              {pending.status === 'failed' ? (
                <Button
                  className="mt-2"
                  type="button"
                  variant="neutral"
                  disabled={sending || promptBlocked}
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
          {!loading && items.length === 0 && store.pending.length === 0 ? (
            <ProviderWelcome pane={pane} items={store.items} />
          ) : null}
        </div>
      </ScrollArea>
      {activeWork ? (
        <div className="shrink-0 space-y-2" data-slot="active-work">
          {activeWork.plan ? (
            <div className="max-h-[min(40vh,18rem)] overflow-y-auto" data-slot="active-plan">
              <PlanUpdateCard item={activeWork.plan} label="TODO" />
            </div>
          ) : null}
          <WorkingIndicator startedMs={activeWork.startedMs} />
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
                  disabled={sending || promptBlocked}
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
            disabled={sending || promptBlocked}
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
            disabled={
              sending || promptBlocked || (draft.trim().length === 0 && attachments.length === 0)
            }
          >
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
        <ConversationStatusStrip pane={pane} />
      </form>
      <span className="sr-only">Current turn: {itemText(items)}</span>
    </div>
  );
}
