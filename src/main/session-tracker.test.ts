import { describe, expect, it, vi } from 'vitest';

import { ConnectedSessionTracker, type SessionEventSubscription } from '@/main/session-tracker';
import type { EngineBootstrap } from '@/shared/herdr';

const statusFixture: Extract<EngineBootstrap, { state: 'connected' }>['status'] = {
  client: {
    version: 'v0.8.0',
    channel: 'stable',
    protocol: 19,
    binary: '/usr/local/bin/herdr',
    session: 'default',
  },
  update: { restart_needed: false },
  server: {
    status: 'running',
    running: true,
    version: 'v0.8.0',
    protocol: 19,
    capabilities: { live_handoff: true, detached_server_daemon: true },
    compatible: true,
    socket: '/tmp/herdr.sock',
    session: 'default',
    restart_needed: false,
  },
};

const connected = (overrides: Record<string, unknown> = {}): EngineBootstrap =>
  ({
    state: 'connected',
    status: statusFixture,
    snapshot: {
      panes: [{ pane_id: 'w1:p1' }, { pane_id: 'w1:p2' }],
    },
    ...overrides,
  }) as unknown as EngineBootstrap;

const stopped = (): EngineBootstrap =>
  ({ state: 'stopped', status: statusFixture }) as unknown as EngineBootstrap;

function makeSubscription() {
  const subscription = { open: vi.fn(), close: vi.fn() };
  return subscription as SessionEventSubscription & typeof subscription;
}

describe('ConnectedSessionTracker', () => {
  it('opens the subscription on the first connected bootstrap', () => {
    const subscription = makeSubscription();
    const tracker = new ConnectedSessionTracker(subscription);

    tracker.track(connected());

    expect(subscription.open).toHaveBeenCalledTimes(1);
    expect(subscription.open).toHaveBeenCalledWith('/tmp/herdr.sock', ['w1:p1', 'w1:p2']);
  });

  it('keeps the subscription open across refreshes of the same session', () => {
    const subscription = makeSubscription();
    const tracker = new ConnectedSessionTracker(subscription);

    tracker.track(connected());
    // Background refreshes re-bootstrap constantly; the subscription must
    // not be torn down (and re-emit connecting/disconnected) for them.
    for (let index = 0; index < 10; index += 1) {
      tracker.track(connected());
    }

    expect(subscription.open).toHaveBeenCalledTimes(1);
    expect(subscription.close).not.toHaveBeenCalled();
  });

  it('re-opens when the server socket changes', () => {
    const subscription = makeSubscription();
    const tracker = new ConnectedSessionTracker(subscription);

    tracker.track(connected());
    tracker.track(
      connected({
        status: {
          ...statusFixture,
          server: { ...statusFixture.server, socket: '/tmp/herdr-2.sock' },
        },
      }),
    );

    expect(subscription.open).toHaveBeenCalledTimes(2);
    expect(subscription.open).toHaveBeenLastCalledWith('/tmp/herdr-2.sock', ['w1:p1', 'w1:p2']);
  });

  it('re-opens when the tracked pane set gains or loses a pane', () => {
    const subscription = makeSubscription();
    const tracker = new ConnectedSessionTracker(subscription);

    tracker.track(connected());
    tracker.track(
      connected({
        snapshot: { panes: [{ pane_id: 'w1:p1' }, { pane_id: 'w1:p2' }, { pane_id: 'w1:p3' }] },
      }),
    );
    expect(subscription.open).toHaveBeenCalledTimes(2);

    // Order changes alone are not a new target.
    tracker.track(
      connected({
        snapshot: { panes: [{ pane_id: 'w1:p2' }, { pane_id: 'w1:p1' }, { pane_id: 'w1:p3' }] },
      }),
    );
    expect(subscription.open).toHaveBeenCalledTimes(2);
  });

  it('closes the subscription when the session is no longer connected', () => {
    const subscription = makeSubscription();
    const tracker = new ConnectedSessionTracker(subscription);

    tracker.track(connected());
    tracker.track(stopped());

    expect(subscription.close).toHaveBeenCalledTimes(1);
  });

  it('re-opens after a disconnect once the session is connected again', () => {
    const subscription = makeSubscription();
    const tracker = new ConnectedSessionTracker(subscription);

    tracker.track(connected());
    tracker.track(stopped());
    tracker.track(connected());

    expect(subscription.close).toHaveBeenCalledTimes(1);
    expect(subscription.open).toHaveBeenCalledTimes(2);
  });
});
