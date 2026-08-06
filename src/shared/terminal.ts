export interface TerminalOpenRequest {
  paneId: string;
  cols: number;
  rows: number;
}

export interface TerminalInputRequest {
  paneId: string;
  text: string;
}

export interface TerminalResizeRequest {
  paneId: string;
  cols: number;
  rows: number;
  cellWidthPx?: number;
  cellHeightPx?: number;
}

export interface TerminalScrollRequest {
  paneId: string;
  direction: 'up' | 'down';
  lines: number;
  source?: 'wheel' | 'page_key';
  column?: number;
  row?: number;
  modifiers?: number;
}

export type TerminalScrollCommand = Omit<TerminalScrollRequest, 'paneId'>;

export type TerminalEvent =
  | {
      type: 'terminal.frame';
      paneId: string;
      seq: number;
      encoding: 'ansi';
      width: number;
      height: number;
      full: boolean;
      bytes: string;
    }
  | { type: 'terminal.closed'; paneId: string; reason: string }
  | { type: 'terminal.error'; paneId: string; message: string };
