import { describe, expect, it, vi } from 'vitest';

import {
  TerminalControllerPool,
  type TerminalSessionController,
} from '@/main/herdr/terminal-controller-pool';

function fakeController(): TerminalSessionController {
  return {
    open: vi.fn(),
    input: vi.fn(),
    resize: vi.fn(),
    scroll: vi.fn(),
    close: vi.fn(),
  };
}

describe('TerminalControllerPool', () => {
  it('keeps independent Herdr controllers for every visible pane', () => {
    const controllers = new Map<string, TerminalSessionController>();
    const pool = new TerminalControllerPool((paneId) => {
      const controller = fakeController();
      controllers.set(paneId, controller);
      return controller;
    });
    const onEvent = vi.fn();

    pool.open({ paneId: 'w1:p1', cols: 80, rows: 24 }, onEvent);
    pool.open({ paneId: 'w1:p2', cols: 60, rows: 24 }, onEvent);
    pool.input('w1:p1', 'one');
    pool.input('w1:p2', 'two');
    pool.resize('w1:p2', 100, 30, 8, 16);
    pool.scroll('w1:p2', {
      direction: 'up',
      lines: 12,
      source: 'page_key',
    });

    expect(controllers.get('w1:p1')?.input).toHaveBeenCalledWith('one');
    expect(controllers.get('w1:p2')?.input).toHaveBeenCalledWith('two');
    expect(controllers.get('w1:p2')?.resize).toHaveBeenCalledWith(100, 30, 8, 16);
    expect(controllers.get('w1:p2')?.scroll).toHaveBeenCalledWith({
      direction: 'up',
      lines: 12,
      source: 'page_key',
    });
  });

  it('closes one pane without releasing other visible terminals', () => {
    const first = fakeController();
    const second = fakeController();
    const factory = vi.fn((paneId: string) => (paneId === 'w1:p1' ? first : second));
    const pool = new TerminalControllerPool(factory);

    pool.open({ paneId: 'w1:p1', cols: 80, rows: 24 }, vi.fn());
    pool.open({ paneId: 'w1:p2', cols: 80, rows: 24 }, vi.fn());
    pool.close('w1:p1');
    pool.input('w1:p2', 'still live');

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
    expect(second.input).toHaveBeenCalledWith('still live');
  });

  it('releases all controllers when the desktop app exits', () => {
    const first = fakeController();
    const second = fakeController();
    const controllers = [first, second];
    const pool = new TerminalControllerPool(() => controllers.shift() as TerminalSessionController);
    pool.open({ paneId: 'w1:p1', cols: 80, rows: 24 }, vi.fn());
    pool.open({ paneId: 'w1:p2', cols: 80, rows: 24 }, vi.fn());

    pool.closeAll();

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });
});
