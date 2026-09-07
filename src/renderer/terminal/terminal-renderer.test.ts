import type { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installTerminalRenderer } from './terminal-renderer';

const gpu = vi.hoisted(() => ({
  lose: () => {},
  dispose: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose = gpu.dispose;
    onContextLoss(callback: () => void) {
      gpu.lose = callback;
      return { dispose: gpu.stop };
    }
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function setup(fail = false) {
  const terminal = {
    rows: 24,
    loadAddon: vi.fn(() => {
      if (fail) throw new Error('WebGL unavailable');
    }),
    refresh: vi.fn(),
  };
  const refit = vi.fn();
  const renderer = installTerminalRenderer(terminal as unknown as Terminal, refit);
  return { terminal, refit, renderer };
}

describe('terminal GPU rendering fallback', () => {
  it('keeps the terminal usable when GPU activation fails', () => {
    const { renderer } = setup(true);
    expect(gpu.dispose).toHaveBeenCalledOnce();
    expect(gpu.stop).toHaveBeenCalledOnce();
    renderer.dispose();
    expect(gpu.dispose).toHaveBeenCalledOnce();
  });

  it('releases a lost GPU and refits and repaints the fallback renderer', () => {
    let repaint: FrameRequestCallback = () => {};
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      repaint = callback;
      return 42;
    });
    const { terminal, refit, renderer } = setup();
    gpu.lose();
    expect(gpu.dispose).toHaveBeenCalledOnce();
    expect(refit).not.toHaveBeenCalled();
    repaint(0);
    expect(refit).toHaveBeenCalledOnce();
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23);
    renderer.dispose();
    expect(gpu.dispose).toHaveBeenCalledOnce();
  });

  it('cancels a pending fallback repaint when the pane unmounts', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { renderer } = setup();
    gpu.lose();
    renderer.dispose();
    expect(cancel).toHaveBeenCalledWith(42);
  });
});
