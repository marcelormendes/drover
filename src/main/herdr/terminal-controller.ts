import {
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
  spawn,
} from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { hostInvocation } from '@/main/flatpak';
import type { TerminalEvent, TerminalOpenRequest, TerminalScrollCommand } from '@/shared/terminal';

export interface TerminalProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export type TerminalProcessSpawner = (
  binary: string,
  args: string[],
  options: SpawnOptionsWithoutStdio & { stdio: ['pipe', 'pipe', 'pipe'] },
) => TerminalProcess;

function defaultSpawner(
  binary: string,
  args: string[],
  options: SpawnOptionsWithoutStdio & { stdio: ['pipe', 'pipe', 'pipe'] },
): ChildProcessWithoutNullStreams {
  return spawn(binary, args, options);
}

function lines(stream: Readable, onLine: (line: string) => void): void {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trimEnd();
      buffer = buffer.slice(newline + 1);
      if (line) {
        onLine(line);
      }
      newline = buffer.indexOf('\n');
    }
  });
}

function terminalFrame(line: string, paneId: string): TerminalEvent | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (
      value.type === 'terminal.frame' &&
      value.encoding === 'ansi' &&
      typeof value.seq === 'number' &&
      typeof value.width === 'number' &&
      typeof value.height === 'number' &&
      typeof value.full === 'boolean' &&
      typeof value.bytes === 'string'
    ) {
      return {
        type: 'terminal.frame',
        paneId,
        seq: value.seq,
        encoding: 'ansi',
        width: value.width,
        height: value.height,
        full: value.full,
        bytes: value.bytes,
      };
    }
    if (value.type === 'terminal.closed') {
      return {
        type: 'terminal.closed',
        paneId,
        reason: typeof value.reason === 'string' ? value.reason : 'Herdr closed the terminal.',
      };
    }
  } catch {
    return null;
  }
  return null;
}

export class TerminalController {
  private child: TerminalProcess | null = null;
  private generation = 0;

  constructor(
    private readonly spawner: TerminalProcessSpawner = defaultSpawner,
    private readonly binary = process.env.HERDR_DESKTOP_BIN || 'herdr',
  ) {}

  open(request: TerminalOpenRequest, onEvent: (event: TerminalEvent) => void): void {
    this.close();
    const generation = ++this.generation;
    const { program, args: bridgedArgs } = hostInvocation(this.binary, [
      'terminal',
      'session',
      'control',
      request.paneId,
      '--takeover',
      '--cols',
      String(request.cols),
      '--rows',
      String(request.rows),
    ]);
    const child = this.spawner(program, bridgedArgs, {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    lines(child.stdout, (line) => {
      if (generation !== this.generation) {
        return;
      }
      const event = terminalFrame(line, request.paneId);
      if (event) {
        onEvent(event);
      }
    });
    lines(child.stderr, (line) => {
      if (generation === this.generation) {
        onEvent({ type: 'terminal.error', paneId: request.paneId, message: line });
      }
    });
    child.once('error', (error) => {
      if (generation === this.generation) {
        onEvent({ type: 'terminal.error', paneId: request.paneId, message: error.message });
      }
    });
    child.once('exit', (code, signal) => {
      if (generation !== this.generation) {
        return;
      }
      this.child = null;
      const reason = signal
        ? `Herdr terminal controller exited with ${signal}.`
        : code
          ? `Herdr terminal controller exited with code ${code}.`
          : 'Terminal control ended. Another client may have taken over this pane.';
      onEvent({ type: 'terminal.closed', paneId: request.paneId, reason });
    });
  }

  input(text: string): void {
    this.write({ type: 'terminal.input', text });
  }

  resize(cols: number, rows: number, cellWidthPx = 0, cellHeightPx = 0): void {
    this.write({
      type: 'terminal.resize',
      cols,
      rows,
      cell_width_px: cellWidthPx,
      cell_height_px: cellHeightPx,
    });
  }

  scroll(request: TerminalScrollCommand): void {
    this.write({ type: 'terminal.scroll', ...request });
  }

  close(): Promise<void> {
    const child = this.child;
    if (!child) {
      return Promise.resolve();
    }
    this.write({ type: 'terminal.release' });
    this.child = null;
    this.generation += 1;
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          clearTimeout(killTimer);
          clearTimeout(capTimer);
          resolve();
        }
      };
      child.once('exit', finish);
      const killTimer = setTimeout(() => child.kill('SIGTERM'), 1_000);
      killTimer.unref();
      const capTimer = setTimeout(finish, 1_500);
      capTimer.unref();
    });
  }

  // Replacement path: no release message — a release that reaches the engine
  // after the successor's takeover would close the successor's stream.
  kill(): void {
    const child = this.child;
    if (!child) {
      return;
    }
    this.child = null;
    this.generation += 1;
    child.kill('SIGTERM');
  }

  private write(command: Record<string, unknown>): void {
    if (this.child?.stdin.writable) {
      this.child.stdin.write(`${JSON.stringify(command)}\n`);
    }
  }
}
