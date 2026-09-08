import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HerdrEventSubscription } from '@/main/herdr/event-subscription';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => item()));
});

describe('HerdrEventSubscription', () => {
  it('refreshes from connected only after acknowledgement covers the snapshot gap', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'drover-events-order-'));
    const socketPath = path.join(directory, 'api.sock');
    let pending: { socket: Socket; id: string } | undefined;
    let revision = 1;
    const snapshots: number[] = [revision];
    const states: string[] = [];
    const server = createServer((socket) => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline !== -1) {
          pending = { socket, id: JSON.parse(buffer.slice(0, newline)).id };
          // A reply for another request must not trigger snapshot refresh.
          socket.write(
            `${JSON.stringify({ id: 'other', result: { type: 'subscription_started' } })}\n`,
          );
          socket.write(
            `${JSON.stringify({ event: 'pane.updated', data: { pane_id: 'w1:p1' } })}\n`,
          );
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
      () => rm(directory, { recursive: true }),
    );
    const onEvent = vi.fn();
    const subscription = new HerdrEventSubscription(onEvent, vi.fn(), {
      onStateChange: (state) => {
        states.push(state);
        // Mirrors the renderer's refresh on connected.
        if (state === 'connected') snapshots.push(revision);
      },
    });
    cleanup.push(async () => subscription.close());
    subscription.open(socketPath, ['w1:p1']);
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce());
    expect(states).not.toContain('connected');
    // This change happens after bootstrap but before subscription registration,
    // so a live-only stream will never replay an event for it.
    revision = 2;
    pending?.socket.write(
      `${JSON.stringify({ id: pending.id, result: { type: 'subscription_started' } })}\n`,
    );
    await vi.waitFor(() => expect(snapshots).toEqual([1, 2]));

    // Conversation subscription changes have the same gap and must resync too.
    subscription.setConversationPanes(['w1:p1']);
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2));
    revision = 3;
    pending?.socket.write(
      `${JSON.stringify({ id: pending.id, result: { type: 'subscription_started' } })}\n`,
    );
    await vi.waitFor(() => expect(snapshots).toEqual([1, 2, 3]));
  });

  it('subscribes to lifecycle and pane-specific events, then forwards pushed envelopes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'drover-events-'));
    const socketPath = path.join(directory, 'api.sock');
    const server = createServer((socket) => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline === -1) {
          return;
        }
        const request = JSON.parse(buffer.slice(0, newline)) as {
          id: string;
          params: { subscriptions: Array<Record<string, unknown>> };
        };
        expect(request.params.subscriptions).toContainEqual({ type: 'workspace.created' });
        expect(request.params.subscriptions).toContainEqual({
          type: 'pane.agent_status_changed',
          pane_id: 'w1:p1',
        });
        socket.write(
          `${JSON.stringify({ id: request.id, result: { type: 'subscription_started' } })}\n`,
        );
        socket.write(
          `${JSON.stringify({ event: 'tab.renamed', data: { tab_id: 'w1:t1', label: 'tests' } })}\n`,
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
      () => rm(directory, { recursive: true }),
    );

    const onEvent = vi.fn();
    const subscription = new HerdrEventSubscription(onEvent);
    cleanup.push(async () => subscription.close());
    subscription.open(socketPath, ['w1:p1']);

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith({
        event: 'tab.renamed',
        data: { tab_id: 'w1:t1', label: 'tests' },
      });
    });
  });

  it('resolves a fresh target before reconnecting after the event stream ends', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'drover-events-reconnect-'));
    const socketPath = path.join(directory, 'api.sock');
    const subscriptions: Array<Array<Record<string, unknown>>> = [];
    let connectionCount = 0;
    const server = createServer((socket) => {
      connectionCount += 1;
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline === -1) {
          return;
        }
        const request = JSON.parse(buffer.slice(0, newline)) as {
          id: string;
          params: { subscriptions: Array<Record<string, unknown>> };
        };
        subscriptions.push(request.params.subscriptions);
        socket.write(
          `${JSON.stringify({ id: request.id, result: { type: 'subscription_started' } })}\n`,
        );
        if (connectionCount === 1) {
          socket.end();
        } else {
          socket.write(
            `${JSON.stringify({ event: 'pane.updated', data: { pane_id: 'w1:p2' } })}\n`,
          );
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
      () => rm(directory, { recursive: true }),
    );

    const onEvent = vi.fn();
    const resolveReconnectTarget = vi.fn(async () => ({
      socketPath,
      paneIds: ['w1:p2'],
      conversationPaneIds: ['w1:p1', 'w1:p2'],
    }));
    const states: string[] = [];
    const subscription = new HerdrEventSubscription(onEvent, vi.fn(), {
      reconnectDelaysMs: [1],
      resolveReconnectTarget,
      onStateChange: (state) => states.push(state),
    });
    cleanup.push(async () => subscription.close());
    subscription.open(socketPath, ['w1:p1']);

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith({
        event: 'pane.updated',
        data: { pane_id: 'w1:p2' },
      });
    });
    expect(resolveReconnectTarget).toHaveBeenCalledOnce();
    expect(subscriptions[0]).toContainEqual({
      type: 'pane.agent_status_changed',
      pane_id: 'w1:p1',
    });
    expect(subscriptions[1]).toContainEqual({
      type: 'pane.agent_status_changed',
      pane_id: 'w1:p2',
    });
    expect(subscriptions[1]).toContainEqual({
      type: 'agent.conversation_changed',
      pane_id: 'w1:p2',
    });
    expect(subscriptions[1]).not.toContainEqual({
      type: 'agent.conversation_changed',
      pane_id: 'w1:p1',
    });
    expect(states).toContain('reconnecting');
    expect(states.at(-1)).toBe('connected');
  });
});

describe('HerdrEventSubscription conversation panes', () => {
  it('does not reopen the subscription when the conversation pane set is unchanged', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'drover-events-'));
    const socketPath = path.join(directory, 'api.sock');
    let subscribeCount = 0;
    const server = createServer((socket) => {
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline === -1) {
          return;
        }
        const request = JSON.parse(buffer.slice(0, newline)) as {
          id: string;
          params: { subscriptions: Array<Record<string, unknown>> };
        };
        subscribeCount += 1;
        expect(request.params.subscriptions).toContainEqual({
          type: 'agent.conversation_changed',
          pane_id: 'w1:p1',
        });
        socket.write(
          `${JSON.stringify({ id: request.id, result: { type: 'subscription_started' } })}\n`,
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
      () => rm(directory, { recursive: true }),
    );

    const subscription = new HerdrEventSubscription(vi.fn());
    cleanup.push(async () => subscription.close());
    subscription.open(socketPath, ['w1:p1']);
    subscription.setConversationPanes(['w1:p1']);
    await vi.waitFor(() => expect(subscribeCount).toBeGreaterThanOrEqual(1));
    const countAfterFirst = subscribeCount;

    // Identical set must not tear down and reopen the stream.
    subscription.setConversationPanes(['w1:p1']);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(subscribeCount).toBe(countAfterFirst);

    // A changed set reopens with the new pane included.
    subscription.setConversationPanes(['w1:p1', 'w1:p2']);
    await vi.waitFor(() => expect(subscribeCount).toBeGreaterThan(countAfterFirst));
  });
});
