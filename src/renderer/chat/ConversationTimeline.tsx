import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  ConversationItem,
  ConversationRespondResult,
  ConversationSessionIdentity,
} from '@/shared/conversation';

const VISIBLE_TOOL_LIMIT = 4;
const VISIBLE_FILE_LIMIT = 8;

type ApprovalItem = Extract<ConversationItem, { type: 'approval' }>;
type FileChangeItem = Extract<ConversationItem, { type: 'file_change' }>;
type ToolActivityItem = Extract<ConversationItem, { type: 'tool_activity' }>;
type TurnStateItem = Extract<ConversationItem, { type: 'turn_state' }>;
type PlanUpdateItem = Extract<ConversationItem, { type: 'plan_update' }>;

interface ConversationTimelineProps {
  items: readonly ConversationItem[];
  paneId: string;
  readerGeneration?: string;
  session?: ConversationSessionIdentity;
  onOpenTerminal?: () => void;
  onRespond: (approval: ApprovalItem, decisionId: string) => Promise<ConversationRespondResult>;
}

interface TurnProjection {
  id: string;
  items: ConversationItem[];
}

interface TurnProps {
  turn: TurnProjection;
  paneId: string;
  readerGeneration?: string;
  session?: ConversationSessionIdentity;
  onOpenTerminal?: () => void;
  onRespond: ConversationTimelineProps['onRespond'];
}

export function ConversationTimeline({
  items,
  paneId,
  readerGeneration,
  session,
  onOpenTerminal,
  onRespond,
}: ConversationTimelineProps) {
  const onOpenTerminalRef = useRef(onOpenTerminal);
  const onRespondRef = useRef(onRespond);
  onOpenTerminalRef.current = onOpenTerminal;
  onRespondRef.current = onRespond;
  const openTerminal = useCallback(() => onOpenTerminalRef.current?.(), []);
  const respond = useCallback<ConversationTimelineProps['onRespond']>(
    (approval, decisionId) => onRespondRef.current(approval, decisionId),
    [],
  );
  const turns = useMemo(() => projectTurns(items), [items]);
  return (
    <>
      {turns.map((turn) => (
        <Turn
          key={turn.id}
          turn={turn}
          paneId={paneId}
          readerGeneration={readerGeneration}
          session={session}
          onOpenTerminal={openTerminal}
          onRespond={respond}
        />
      ))}
    </>
  );
}

export function formatDuration(milliseconds: number | undefined): string | null {
  if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) {
    return null;
  }
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function projectTurns(items: readonly ConversationItem[]): TurnProjection[] {
  const turns = new Map<string, TurnProjection>();
  for (const item of items) {
    const id = item.turn_id ? `turn:${item.turn_id}` : `item:${item.id}`;
    const turn = turns.get(id);
    if (turn) {
      turn.items.push(item);
    } else {
      turns.set(id, { id, items: [item] });
    }
  }
  return [...turns.values()];
}

const Turn = memo(function Turn({
  turn,
  paneId,
  readerGeneration,
  session,
  onOpenTerminal,
  onRespond,
}: TurnProps) {
  const users = turn.items.filter(
    (item): item is Extract<ConversationItem, { type: 'user_message' }> =>
      item.type === 'user_message',
  );
  const finals = turn.items.filter(
    (item): item is Extract<ConversationItem, { type: 'assistant_message' }> =>
      item.type === 'assistant_message' && item.phase === 'final',
  );
  const files = turn.items.filter((item): item is FileChangeItem => item.type === 'file_change');
  const approvals = turn.items.filter((item): item is ApprovalItem => item.type === 'approval');
  const states = turn.items.filter((item): item is TurnStateItem => item.type === 'turn_state');
  const latestState = states.at(-1);
  const settled = latestState && latestState.state !== 'started' ? latestState : undefined;
  const collapseWork =
    finals.length > 0 || (settled !== undefined && settled.state !== 'completed');
  const work = turn.items.filter(
    (item) =>
      item.type !== 'user_message' &&
      item.type !== 'file_change' &&
      item.type !== 'approval' &&
      item.type !== 'turn_state' &&
      !(item.type === 'assistant_message' && item.phase === 'final'),
  );

  return (
    <section
      className="space-y-3 [contain-intrinsic-size:auto_16rem] [content-visibility:auto]"
      data-slot="conversation-turn"
    >
      {users.map((item) => (
        <UserMessage key={item.id} item={item} />
      ))}
      {work.length > 0 && !collapseWork ? <WorkRows expanded items={work} /> : null}
      {work.length > 0 && collapseWork ? <SettledWork state={settled} items={work} /> : null}
      {approvals.map((approval) => (
        <ApprovalRow
          key={approval.id}
          approval={approval}
          paneId={paneId}
          readerGeneration={readerGeneration}
          session={session}
          onOpenTerminal={onOpenTerminal}
          onRespond={onRespond}
        />
      ))}
      {finals.length > 0 || files.length > 0 ? (
        <div className="space-y-2" data-testid="turn-response">
          {finals.map((item) => (
            <FinalAnswer key={item.id} item={item} />
          ))}
          {files.length > 0 ? <ChangedFiles files={files} /> : null}
        </div>
      ) : null}
      {settled && work.length === 0 && finals.length === 0 ? (
        <div className="text-xs font-bold text-muted-foreground">{settledLabel(settled)}</div>
      ) : null}
    </section>
  );
}, sameTurnProps);
function sameTurnProps(previous: TurnProps, next: TurnProps): boolean {
  if (
    previous.turn.id !== next.turn.id ||
    previous.paneId !== next.paneId ||
    previous.readerGeneration !== next.readerGeneration ||
    previous.session?.id !== next.session?.id ||
    previous.onOpenTerminal !== next.onOpenTerminal ||
    previous.onRespond !== next.onRespond ||
    previous.turn.items.length !== next.turn.items.length
  ) {
    return false;
  }
  return previous.turn.items.every((item, index) => item === next.turn.items[index]);
}

export function latestPlanUpdate(items: readonly ConversationItem[]): PlanUpdateItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type === 'plan_update') {
      return item;
    }
  }
  return undefined;
}

export const PlanUpdateCard = memo(function PlanUpdateCard({
  item,
  label = 'Plan',
}: {
  item: PlanUpdateItem;
  label?: string;
}) {
  return (
    <div className="rounded-base border-2 border-border bg-secondary-background p-3 text-sm">
      <div className="mb-2 text-xs font-bold uppercase text-muted-foreground">{label}</div>
      <ul className="space-y-1">
        {item.steps.map((step) => (
          <li key={`${step.label}:${step.status}`}>
            <span className="mr-2" aria-hidden="true">
              {step.status === 'completed' ? '✓' : step.status === 'active' ? '•' : '○'}
            </span>
            {step.label}
            <span className="ml-2 text-xs text-muted-foreground">{step.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});

export function WorkingIndicator({ startedMs }: { startedMs?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = startedMs === undefined ? 0 : Math.max(0, Math.floor((now - startedMs) / 1_000));
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-base border-2 border-main bg-secondary-background px-3 py-2 text-sm shadow-shadow"
      role="status"
    >
      <span className="motion-safe:animate-pulse text-main" aria-hidden="true">
        ●
      </span>
      <span className="font-bold">Working{elapsed > 0 ? ` for ${elapsed}s` : ''}</span>
    </div>
  );
}

const SettledWork = memo(function SettledWork({
  state,
  items,
}: {
  state?: TurnStateItem;
  items: ConversationItem[];
}) {
  return (
    <details
      className="rounded-base border-2 border-border bg-secondary-background text-sm"
      data-testid="turn-work-summary"
    >
      <summary className="cursor-pointer px-3 py-2 font-bold">
        {state ? settledLabel(state) : 'Work'}
      </summary>
      <div className="space-y-2 border-t-2 border-border p-2">
        <WorkRows items={items} />
      </div>
    </details>
  );
});

function settledLabel(state: TurnStateItem): string {
  const duration = formatDuration(state.duration_ms);
  if (state.state === 'completed') {
    return `Worked${duration ? ` for ${duration}` : ''}`;
  }
  if (state.state === 'interrupted') {
    return `Stopped${duration ? ` after ${duration}` : ''}`;
  }
  return `Failed${duration ? ` after ${duration}` : ''}${state.error ? `: ${state.error}` : ''}`;
}

const WorkRows = memo(function WorkRows({
  expanded = false,
  items,
}: {
  expanded?: boolean;
  items: readonly ConversationItem[];
}) {
  const rows: ReactNode[] = [];
  let toolCount = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.type !== 'tool_activity') {
      rows.push(<WorkItemRow expanded={expanded} key={item.id} item={item} />);
      continue;
    }
    toolCount += 1;
    if (expanded || toolCount <= VISIBLE_TOOL_LIMIT) {
      rows.push(<ToolActivityRow expanded={expanded} key={item.id} item={item} />);
      continue;
    }
    const grouped = [item];
    while (items[index + 1]?.type === 'tool_activity') {
      index += 1;
      toolCount += 1;
      grouped.push(items[index] as ToolActivityItem);
    }
    rows.push(<GroupedTools key={`group:${grouped[0].id}`} items={grouped} />);
  }
  return <>{rows}</>;
});

const WorkItemRow = memo(function WorkItemRow({
  expanded,
  item,
}: {
  expanded: boolean;
  item: ConversationItem;
}) {
  switch (item.type) {
    case 'assistant_message':
      return (
        <div className="border-l-4 border-main px-3 py-1 text-sm" data-slot="commentary">
          <MarkdownText text={item.text} />
        </div>
      );
    case 'plan_update':
      return expanded ? null : <PlanUpdateCard item={item} />;
    case 'notice':
      return <div className="text-xs text-muted-foreground">{item.message}</div>;
    case 'tool_activity':
      return <ToolActivityRow item={item} />;
    default:
      return null;
  }
});

const ToolActivityRow = memo(function ToolActivityRow({
  expanded = false,
  item,
}: {
  expanded?: boolean;
  item: ToolActivityItem;
}) {
  const [open, setOpen] = useState(false);
  const duration = formatDuration(item.duration_ms);
  const label =
    item.label === 'completed' || item.label === 'failed' ? item.action : item.label || item.action;
  const statusLabel =
    item.status === 'running' ? 'running' : item.status === 'failed' ? 'failed' : 'completed';
  const statusMark = item.status === 'running' ? '●' : item.status === 'failed' ? '✕' : '✓';
  const hasDetail = Boolean(
    item.preview ||
      item.detail ||
      (duration !== null && duration !== '0s') ||
      (item.paths?.length ?? 0) > 0,
  );
  const summary = (
    <>
      <span
        className={cn(
          'mr-2 font-mono text-xs',
          item.status === 'running' && 'motion-safe:animate-pulse text-main',
        )}
        aria-hidden="true"
      >
        {statusMark}
      </span>
      <span className="font-medium">{label}</span>
      <span className="ml-2 text-xs text-muted-foreground">{statusLabel}</span>
    </>
  );
  if (!hasDetail) {
    return (
      <div
        className="rounded-base border-2 border-border bg-secondary-background px-3 py-2 text-sm"
        data-slot="tool-activity"
      >
        {summary}
      </div>
    );
  }
  return (
    <details
      className="rounded-base border-2 border-border bg-secondary-background text-sm"
      data-slot="tool-activity"
      open={expanded || open}
      onToggle={(event) => {
        if (!expanded) {
          setOpen(event.currentTarget.open);
        }
      }}
    >
      <summary className="cursor-pointer px-3 py-2">{summary}</summary>
      <div className="border-t-2 border-border px-3 py-2 text-xs text-muted-foreground">
        {duration !== null && duration !== '0s' ? <div>Duration: {duration}</div> : null}
        {item.preview ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-base border-2 border-border bg-black p-3 text-white">
            <code>{item.preview}</code>
          </pre>
        ) : null}
        {item.detail ? <div className="whitespace-pre-wrap break-words">{item.detail}</div> : null}
        {item.paths?.length ? <div>Files: {item.paths.join(', ')}</div> : null}
      </div>
    </details>
  );
});

const GroupedTools = memo(function GroupedTools({ items }: { items: ToolActivityItem[] }) {
  return (
    <details className="rounded-base border-2 border-border bg-secondary-background text-sm">
      <summary className="cursor-pointer px-3 py-2 font-medium">
        +{items.length} tool {items.length === 1 ? 'call' : 'calls'}
      </summary>
      <div className="space-y-2 border-t-2 border-border p-2">
        {items.map((item) => (
          <ToolActivityRow key={item.id} item={item} />
        ))}
      </div>
    </details>
  );
});

const UserMessage = memo(function UserMessage({
  item,
}: {
  item: Extract<ConversationItem, { type: 'user_message' }>;
}) {
  return (
    <div className="rounded-base border-2 border-border bg-secondary-background p-3 text-sm">
      <div className="mb-1 text-xs font-bold uppercase text-muted-foreground">You</div>
      {item.text ? <p className="whitespace-pre-wrap break-words">{item.text}</p> : null}
      {item.attachments?.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.attachments.map((attachment) => (
            <span
              className="rounded-base border border-border px-2 py-1 font-mono text-[11px]"
              key={`${attachment.name}:${attachment.media_type}:${attachment.byte_size}`}
            >
              {attachment.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
});

const FinalAnswer = memo(function FinalAnswer({
  item,
}: {
  item: Extract<ConversationItem, { type: 'assistant_message' }>;
}) {
  return (
    <article
      className="rounded-base border-2 border-border bg-background p-4 text-sm shadow-shadow"
      data-testid="final-answer"
    >
      <MarkdownText text={item.text} />
    </article>
  );
});

const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words text-response-foreground [&_a]:font-bold [&_a]:text-main [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-secondary-background [&_code]:px-1 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-heading [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-heading [&_h3]:mb-1 [&_h3]:font-heading [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-base [&_pre]:border-2 [&_pre]:border-border [&_pre]:bg-secondary-background [&_pre]:p-3 [&_strong]:font-bold">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
});

function ChangedFiles({ files }: { files: FileChangeItem[] }) {
  const visible = files.slice(0, VISIBLE_FILE_LIMIT);
  const hidden = files.length - visible.length;
  return (
    <details className="rounded-base border-2 border-border bg-secondary-background text-sm">
      <summary className="cursor-pointer px-3 py-2 font-bold">
        Changed files <span className="text-xs text-muted-foreground">({files.length})</span>
      </summary>
      <ul className="space-y-1 border-t-2 border-border px-3 py-2 font-mono text-xs">
        {visible.map((file) => (
          <li className="min-w-0 break-all" key={file.id}>
            <span className="mr-2 font-base text-muted-foreground">{file.change}</span>
            {file.path}
            {file.summary ? <span className="ml-2 font-base">{file.summary}</span> : null}
          </li>
        ))}
        {hidden > 0 ? (
          <li className="font-base text-muted-foreground">+{hidden} more files</li>
        ) : null}
      </ul>
    </details>
  );
}

function ApprovalRow({
  approval,
  readerGeneration,
  session,
  onOpenTerminal,
  onRespond,
}: {
  approval: ApprovalItem;
  paneId: string;
  readerGeneration?: string;
  session?: ConversationSessionIdentity;
  onOpenTerminal?: () => void;
  onRespond: ConversationTimelineProps['onRespond'];
}) {
  const [responding, setResponding] = useState<string>();
  const [result, setResult] = useState<string>();
  const canRespond =
    approval.status === 'pending' &&
    approval.structured_response &&
    Boolean(readerGeneration && session);

  const respond = async (decisionId: string) => {
    setResponding(decisionId);
    setResult(undefined);
    try {
      const response = await onRespond(approval, decisionId);
      setResult(response.accepted ? 'Response sent.' : response.reason.replaceAll('_', ' '));
    } catch (reason) {
      setResult(reason instanceof Error ? reason.message : 'Could not send response.');
    } finally {
      setResponding(undefined);
    }
  };

  return (
    <section className="rounded-base border-2 border-border bg-secondary-background p-3 text-sm">
      <div className="font-bold">Approval {approval.status}</div>
      <p className="mt-1 whitespace-pre-wrap">{approval.prompt}</p>
      {canRespond ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {approval.decisions.map((decision) => (
            <Button
              type="button"
              disabled={Boolean(responding)}
              key={decision.id}
              onClick={() => void respond(decision.id)}
              variant="neutral"
            >
              {responding === decision.id ? 'Sending…' : decision.label}
            </Button>
          ))}
        </div>
      ) : approval.status === 'pending' ? (
        onOpenTerminal ? (
          <Button className="mt-3" type="button" variant="neutral" onClick={onOpenTerminal}>
            Open Terminal to respond
          </Button>
        ) : (
          <div className="mt-2 text-xs text-muted-foreground">Open Terminal to respond.</div>
        )
      ) : approval.selected_decision ? (
        <div className="mt-2 text-xs text-muted-foreground">
          Selected: {approval.selected_decision}
        </div>
      ) : null}
      {result ? (
        <div aria-live="polite" className="mt-2 text-xs text-muted-foreground">
          {result}
        </div>
      ) : null}
    </section>
  );
}
