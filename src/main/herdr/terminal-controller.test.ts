import { EventEmitter } from 'node:events';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FLATPAK_APP_ID } from '@/main/flatpak';
import {
  TerminalController,
  type TerminalProcess,
  type TerminalProcessSpawner,
} from '@/main/herdr/terminal-controller';

type FakeTerminalProcess = TerminalProcess &
  EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
  };

function fakeProcess(): FakeTerminalProcess {
  const process = new EventEmitter() as TerminalProcess & EventEmitter;
  process.stdin = new PassThrough();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.kill = vi.fn(() => true);
  return process as FakeTerminalProcess;
}

describe('TerminalController', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('routes terminal control through flatpak-spawn --host inside the Drover Flatpak', () => {
    vi.stubEnv('FLATPAK_ID', FLATPAK_APP_ID);
    vi.stubEnv('HERDR_SOCKET_PATH', '');
    vi.stubEnv('HERDR_CLIENT_SOCKET_PATH', '');
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    const child = fakeProcess();
    const spawn: TerminalProcessSpawner = vi.fn(() => child);
    const controller = new TerminalController(spawn, '/usr/local/bin/herdr');

    controller.open({ paneId: 'w1:p1', cols: 120, rows: 40 }, vi.fn());

    expect(spawn).toHaveBeenCalledWith(
      'flatpak-spawn',
      [
        '--host',
        '--watch-bus',
        '--env=PATH=/home/tester/.local/bin:/usr/local/bin:/usr/bin:/bin',
        '/usr/local/bin/herdr',
        'terminal',
        'session',
        'control',
        'w1:p1',
        '--takeover',
        '--cols',
        '120',
        '--rows',
        '40',
      ],
      expect.objectContaining({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    controller.close();
  });

  it('bridges Herdr terminal frames and NDJSON input without owning the PTY', async () => {
    const child = fakeProcess();
    const spawn: TerminalProcessSpawner = vi.fn(() => child);
    const events = vi.fn();
    const writes: string[] = [];
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk) => writes.push(chunk));
    const controller = new TerminalController(spawn, '/usr/local/bin/herdr');

    controller.open({ paneId: 'w1:p1', cols: 120, rows: 40 }, events);

    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/herdr',
      ['terminal', 'session', 'control', 'w1:p1', '--takeover', '--cols', '120', '--rows', '40'],
      expect.objectContaining({ shell: false }),
    );

    child.stdout.write(
      `${JSON.stringify({
        type: 'terminal.frame',
        seq: 1,
        encoding: 'ansi',
        width: 120,
        height: 40,
        full: true,
        bytes: 'G1sySg==',
      })}\n`,
    );
    await vi.waitFor(() => {
      expect(events).toHaveBeenCalledWith({
        type: 'terminal.frame',
        paneId: 'w1:p1',
        seq: 1,
        encoding: 'ansi',
        width: 120,
        height: 40,
        full: true,
        bytes: 'G1sySg==',
      });
    });

    controller.input('hello\n');
    controller.resize(100, 32, 8, 16);
    controller.scroll({
      direction: 'up',
      lines: 4,
      source: 'page_key',
      column: 6,
      row: 9,
      modifiers: 1,
    });
    controller.close();

    expect(writes).toEqual([
      `${JSON.stringify({ type: 'terminal.input', text: 'hello\n' })}\n`,
      `${JSON.stringify({
        type: 'terminal.resize',
        cols: 100,
        rows: 32,
        cell_width_px: 8,
        cell_height_px: 16,
      })}\n`,
      `${JSON.stringify({
        type: 'terminal.scroll',
        direction: 'up',
        lines: 4,
        source: 'page_key',
        column: 6,
        row: 9,
        modifiers: 1,
      })}\n`,
      `${JSON.stringify({ type: 'terminal.release' })}\n`,
    ]);
  });

  it('reports control errors and terminal closure to the renderer', async () => {
    const child = fakeProcess();
    const events = vi.fn();
    const controller = new TerminalController(() => child, 'herdr');
    controller.open({ paneId: 'w1:p2', cols: 80, rows: 24 }, events);

    child.stderr.write('herdr: terminal is already controlled\n');
    child.emit('exit', 1, null);

    await vi.waitFor(() => {
      expect(events).toHaveBeenCalledWith({
        type: 'terminal.error',
        paneId: 'w1:p2',
        message: 'herdr: terminal is already controlled',
      });
      expect(events).toHaveBeenCalledWith({
        type: 'terminal.closed',
        paneId: 'w1:p2',
        reason: 'Herdr terminal controller exited with code 1.',
      });
    });
  });

  it('explains a clean exit as control moving to another client', async () => {
    const child = fakeProcess();
    const events = vi.fn();
    const controller = new TerminalController(() => child, 'herdr');
    controller.open({ paneId: 'w1:p3', cols: 80, rows: 24 }, events);

    child.emit('exit', 0, null);

    await vi.waitFor(() => {
      expect(events).toHaveBeenCalledWith({
        type: 'terminal.closed',
        paneId: 'w1:p3',
        reason: 'Terminal control ended. Another client may have taken over this pane.',
      });
    });
  });

  it('kills a replaced controller without sending a release that could race a takeover', () => {
    const child = fakeProcess();
    const events = vi.fn();
    const writes: string[] = [];
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk) => writes.push(chunk));
    const controller = new TerminalController(() => child, 'herdr');
    controller.open({ paneId: 'w1:p4', cols: 80, rows: 24 }, events);

    controller.kill();
    child.emit('exit', 0, null);

    expect(writes).toEqual([]);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(events).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'terminal.closed' }));
  });
});
