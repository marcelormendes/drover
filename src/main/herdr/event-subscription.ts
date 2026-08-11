import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { decodeConversationChangedEvent } from '@/main/herdr/conversation-decoder';
import type { HerdrEventConnectionState, HerdrEventEnvelope } from '@/shared/events';

export interface HerdrEventTarget {
  socketPath: string;
  paneIds: string[];
  conversationPaneIds: string[];
}

interface HerdrEventSubscriptionOptions {
  reconnectDelaysMs?: readonly number[];
  resolveReconnectTarget?: () => Promise<HerdrEventTarget>;
  onStateChange?: (state: HerdrEventConnectionState) => void;
}

const defaultReconnectDelaysMs = [250, 500, 1_000, 2_000, 5_000] as const;

const lifecycleSubscriptions = [
  'workspace.created',
  'workspace.updated',
  'workspace.metadata_updated',
  'workspace.renamed',
  'workspace.moved',
  'workspace.reordered',
  'workspace.closed',
  'workspace.focused',
  'worktree.created',
  'worktree.opened',
  'worktree.removed',
  'tab.created',
  'tab.closed',
  'tab.focused',
  'tab.renamed',
  'tab.moved',
  'pane.created',
  'pane.closed',
  'pane.updated',
  'pane.focused',
  'pane.moved',
  'pane.exited',
  'pane.agent_detected',
  'layout.updated',
] as const;

function subscriptionParams(
  paneIds: string[],
  conversationPaneIds: string[],
): Array<Record<string, unknown>> {
  return [
    ...lifecycleSubscriptions.map((type) => ({ type })),
    ...paneIds.flatMap((paneId) => [
      { type: 'pane.agent_status_changed', pane_id: paneId },
      { type: 'pane.scroll_changed', pane_id: paneId },
    ]),
    ...conversationPaneIds.map((pane_id) => ({
      type: 'agent.conversation_changed',
      pane_id,
    })),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEvent(line: string): HerdrEventEnvelope | null {
  try {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value) || typeof value.event !== 'string' || !isRecord(value.data)) {
      return null;
    }
    if (value.event === 'agent.conversation_changed') {
      const data = decodeConversationChangedEvent(value.data);
      return data ? { event: value.event, data: { ...data } } : null;
    }
    return { event: value.event, data: value.data };
  } catch {
    return null;
  }
}

export class HerdrEventSubscription {
  private socket: Socket | null = null;
  private target: HerdrEventTarget | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private generation = 0;
  private conversationPaneIds: string[] = [];

  constructor(
    private readonly onEvent: (event: HerdrEventEnvelope) => void,
    private readonly onError: (error: Error) => void = () => undefined,
    private readonly options: HerdrEventSubscriptionOptions = {},
  ) {}

  open(socketPath: string, paneIds: string[]): void {
    this.close();
    const paneSet = new Set(paneIds);
    this.target = {
      socketPath,
      paneIds: [...paneIds],
      conversationPaneIds: this.conversationPaneIds.filter((paneId) => paneSet.has(paneId)),
    };
    this.reconnectAttempt = 0;
    this.connect(this.target, false, this.generation);
  }

  private connect(target: HerdrEventTarget, reconnecting: boolean, generation: number): void {
    this.emitState(reconnecting ? 'reconnecting' : 'connecting');
    const socket = createConnection(target.socketPath);
    this.socket = socket;
    let buffer = '';
    let disconnected = false;

    const handleDisconnect = (error?: Error) => {
      if (disconnected || generation !== this.generation || !this.target) {
        return;
      }
      disconnected = true;
      if (this.socket === socket) {
        this.socket = null;
      }
      if (error) {
        this.onError(error);
      }
      this.scheduleReconnect(generation);
    };

    socket.setEncoding('utf8');
    socket.once('connect', () => {
      if (generation !== this.generation) {
        socket.destroy();
        return;
      }
      socket.write(
        `${JSON.stringify({
          id: `desktop:events:${randomUUID()}`,
          method: 'events.subscribe',
          params: {
            subscriptions: subscriptionParams(target.paneIds, target.conversationPaneIds),
          },
        })}\n`,
      );
      this.emitState('connected');
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const event = parseEvent(line);
        if (event) {
          this.reconnectAttempt = 0;
          this.onEvent(event);
        }
        newline = buffer.indexOf('\n');
      }
    });
    socket.once('error', (error) => handleDisconnect(error));
    socket.once('close', () => handleDisconnect());
  }

  private scheduleReconnect(generation: number): void {
    if (this.reconnectTimer || generation !== this.generation || !this.target) {
      return;
    }
    this.emitState('reconnecting');
    const delays = this.options.reconnectDelaysMs ?? defaultReconnectDelaysMs;
    const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)] ?? 0;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect(generation);
    }, delay);
  }

  private async reconnect(generation: number): Promise<void> {
    try {
      const target = this.options.resolveReconnectTarget
        ? await this.options.resolveReconnectTarget()
        : this.target;
      if (generation !== this.generation || !target) {
        return;
      }
      const paneSet = new Set(target.paneIds);
      this.target = {
        socketPath: target.socketPath,
        paneIds: [...target.paneIds],
        conversationPaneIds: target.conversationPaneIds.filter((paneId) => paneSet.has(paneId)),
      };
      this.connect(this.target, true, generation);
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.onError(error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect(generation);
    }
  }

  private emitState(state: HerdrEventConnectionState): void {
    this.options.onStateChange?.(state);
  }

  getConversationPaneIds(): string[] {
    return [...this.conversationPaneIds];
  }

  setConversationPanes(paneIds: readonly string[]): void {
    const next = [...new Set(paneIds)];
    const same =
      next.length === this.conversationPaneIds.length &&
      next.every((paneId) => this.conversationPaneIds.includes(paneId));
    if (same) {
      return;
    }
    this.conversationPaneIds = next;
    const target = this.target;
    if (target) {
      this.open(target.socketPath, target.paneIds);
    }
  }

  close(): void {
    this.generation += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.target = null;
    this.socket?.destroy();
    this.socket = null;
    this.emitState('disconnected');
  }
}
