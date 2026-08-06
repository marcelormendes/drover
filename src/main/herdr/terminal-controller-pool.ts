import { TerminalController } from '@/main/herdr/terminal-controller';
import type { TerminalEvent, TerminalOpenRequest, TerminalScrollCommand } from '@/shared/terminal';

export interface TerminalSessionController {
  open(request: TerminalOpenRequest, onEvent: (event: TerminalEvent) => void): void;
  input(text: string): void;
  resize(cols: number, rows: number, cellWidthPx?: number, cellHeightPx?: number): void;
  scroll(command: TerminalScrollCommand): void;
  close(): void;
}

export type TerminalControllerFactory = (paneId: string) => TerminalSessionController;

export class TerminalControllerPool {
  private readonly controllers = new Map<string, TerminalSessionController>();

  constructor(
    private readonly createController: TerminalControllerFactory = () => new TerminalController(),
  ) {}

  open(request: TerminalOpenRequest, onEvent: (event: TerminalEvent) => void): void {
    this.close(request.paneId);
    const controller = this.createController(request.paneId);
    this.controllers.set(request.paneId, controller);
    controller.open(request, onEvent);
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
    this.controllers.get(paneId)?.close();
    this.controllers.delete(paneId);
  }

  closeAll(): void {
    for (const controller of this.controllers.values()) {
      controller.close();
    }
    this.controllers.clear();
  }
}
