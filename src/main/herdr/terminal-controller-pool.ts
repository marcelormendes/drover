import { TerminalController } from '@/main/herdr/terminal-controller';
import type { TerminalEvent, TerminalOpenRequest, TerminalScrollCommand } from '@/shared/terminal';

export interface TerminalSessionController {
  open(request: TerminalOpenRequest, onEvent: (event: TerminalEvent) => void): void;
  input(text: string): void;
  resize(cols: number, rows: number, cellWidthPx?: number, cellHeightPx?: number): void;
  scroll(command: TerminalScrollCommand): void;
  close(): void | Promise<void>;
  kill(): void;
}

export type TerminalControllerFactory = (paneId: string) => TerminalSessionController;

export class TerminalControllerPool {
  private readonly controllers = new Map<string, TerminalSessionController>();
  private readonly draining = new Map<string, Promise<void>>();

  constructor(
    private readonly createController: TerminalControllerFactory = () => new TerminalController(),
  ) {}

  open(request: TerminalOpenRequest, onEvent: (event: TerminalEvent) => void): void {
    // Kill (not close) any previous controller: a queued release arriving after
    // the new controller's takeover would tear the fresh attachment down.
    const existing = this.controllers.get(request.paneId);
    if (existing) {
      existing.kill();
      this.controllers.delete(request.paneId);
    }
    const controller = this.createController(request.paneId);
    this.controllers.set(request.paneId, controller);
    const drained = this.draining.get(request.paneId);
    if (drained) {
      // A predecessor is still exiting. Spawning now can lose the takeover race
      // to it, so defer until its process is gone.
      void drained.then(() => {
        if (this.controllers.get(request.paneId) === controller) {
          controller.open(request, onEvent);
        }
      });
    } else {
      controller.open(request, onEvent);
    }
  }

  input(paneId: string, text: string): void {
    this.controllers.get(paneId)?.input(text);
  }

  resize(
    paneId: string,
    cols: number,
    rows: number,
    cellWidthPx?: number,
    cellHeightPx?: number,
  ): void {
    this.controllers.get(paneId)?.resize(cols, rows, cellWidthPx, cellHeightPx);
  }

  scroll(paneId: string, command: TerminalScrollCommand): void {
    this.controllers.get(paneId)?.scroll(command);
  }

  close(paneId: string): void {
    const controller = this.controllers.get(paneId);
    this.controllers.delete(paneId);
    if (!controller) {
      return;
    }
    const drained = Promise.resolve(controller.close()).then(() => {
      if (this.draining.get(paneId) === drained) {
        this.draining.delete(paneId);
      }
    });
    this.draining.set(paneId, drained);
  }

  closeAll(): void {
    for (const controller of this.controllers.values()) {
      controller.close();
    }
    this.controllers.clear();
  }
}
