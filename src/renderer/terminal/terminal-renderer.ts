import { WebglAddon } from '@xterm/addon-webgl';
import type { Terminal } from '@xterm/xterm';

/** Install after open(), before the initial fit, so the grid uses GPU cell metrics. */
export function installTerminalRenderer(terminal: Terminal, refit: () => void) {
  let addon: WebglAddon | undefined;
  let lossListener: { dispose(): void } | undefined;
  let frame: number | undefined;

  const release = () => {
    lossListener?.dispose();
    lossListener = undefined;
    const previous = addon;
    addon = undefined;
    try {
      previous?.dispose();
    } catch {
      // A GPU that failed during activation can also fail during teardown.
    }
  };

  try {
    addon = new WebglAddon();
    lossListener = addon.onContextLoss(() => {
      release();
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        refit();
        terminal.refresh(0, terminal.rows - 1);
      });
    });
    terminal.loadAddon(addon);
  } catch {
    // xterm's DOM renderer remains usable when WebGL is unavailable.
    release();
  }

  return {
    dispose() {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      release();
    },
  };
}
