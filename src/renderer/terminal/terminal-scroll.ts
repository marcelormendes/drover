const PIXELS_PER_LINE = 40;
const MAX_SCROLL_LINES = 65_535;

/** Use xterm's screen rect, which excludes the host pane's padding and toolbar. */
export function terminalWheelPosition(
  clientX: number,
  clientY: number,
  screen: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  cols: number,
  rows: number,
): { column: number; row: number } | undefined {
  if (
    ![clientX, clientY, screen.left, screen.top, screen.width, screen.height, cols, rows].every(
      Number.isFinite,
    ) ||
    screen.width <= 0 ||
    screen.height <= 0 ||
    !Number.isInteger(cols) ||
    cols < 1 ||
    !Number.isInteger(rows) ||
    rows < 1
  )
    return undefined;
  return {
    column: Math.max(
      0,
      Math.min(cols - 1, Math.floor(((clientX - screen.left) * cols) / screen.width)),
    ),
    row: Math.max(
      0,
      Math.min(rows - 1, Math.floor(((clientY - screen.top) * rows) / screen.height)),
    ),
  };
}

export function terminalWheelModifiers(event: {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): number {
  // Herdr's public scroll command uses crossterm KeyModifiers bit flags.
  return (
    (event.shiftKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.altKey ? 4 : 0) |
    (event.metaKey ? 8 : 0)
  );
}

/** Own one accumulator per pane so sub-line trackpad movement survives frames. */
export function createTerminalWheelAccumulator() {
  let pendingPixels = 0;
  return {
    add(deltaY: number, deltaMode: number, viewportRows: number): void {
      if (!Number.isFinite(deltaY)) return;
      let pixels: number;
      if (deltaMode === 0) {
        pixels = deltaY;
      } else if (deltaMode === 1) {
        pixels = deltaY * PIXELS_PER_LINE;
      } else if (deltaMode === 2 && Number.isFinite(viewportRows) && viewportRows > 0) {
        pixels = deltaY * viewportRows * PIXELS_PER_LINE;
      } else {
        return;
      }
      // Keep each public terminal.scroll request inside the engine's u16 bound.
      pendingPixels = Math.max(
        -MAX_SCROLL_LINES * PIXELS_PER_LINE,
        Math.min(MAX_SCROLL_LINES * PIXELS_PER_LINE, pendingPixels + pixels),
      );
    },
    takeLines(): number {
      const lines = Math.trunc(pendingPixels / PIXELS_PER_LINE);
      pendingPixels -= lines * PIXELS_PER_LINE;
      return lines === 0 ? 0 : lines;
    },
    reset(): void {
      pendingPixels = 0;
    },
  };
}
