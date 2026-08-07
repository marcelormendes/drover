import type { EngineBootstrap } from '@/shared/herdr';

export interface SessionEventSubscription {
  open(socketPath: string, paneIds: string[]): void;
  close(): void;
}

interface SessionTarget {
  socketPath: string;
  paneIds: string[];
}

/**
 * Keeps the event subscription attached to the session the engine reports.
 * Re-bootstrapping (background refreshes, commands) returns the same session
 * every time; tearing the subscription down on each one would re-emit
 * connecting/disconnected state and blink the connection pill.
 */
export class ConnectedSessionTracker {
  private target: SessionTarget | null = null;

  constructor(private readonly subscription: SessionEventSubscription) {}

  track(result: EngineBootstrap): EngineBootstrap {
    if (result.state === 'connected') {
      const socketPath = result.status.server.socket;
      const paneIds = result.snapshot.panes.map((pane) => pane.pane_id);
      if (
        this.target &&
        this.target.socketPath === socketPath &&
        samePaneSet(this.target.paneIds, paneIds)
      ) {
        return result;
      }
      this.target = { socketPath, paneIds };
      this.subscription.open(socketPath, paneIds);
      return result;
    }
    this.target = null;
    this.subscription.close();
    return result;
  }
}

function samePaneSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((paneId) => rightSet.has(paneId));
}
