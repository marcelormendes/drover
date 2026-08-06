import { describe, expect, it } from 'vitest';

import {
  clampSplitRatio,
  keyboardSplitRatio,
  ratioFromPointer,
  splitHandlePosition,
} from '@/renderer/panes/split-handles-model';
import type { PaneLayoutSnapshot } from '@/shared/herdr';

const layout: PaneLayoutSnapshot = {
  workspace_id: 'w1',
  tab_id: 't1',
  zoomed: false,
  area: { x: 0, y: 0, width: 100, height: 80 },
  focused_pane_id: 'p1',
  panes: [],
  splits: [
    {
      id: 'vertical',
      direction: 'right',
      ratio: 0.5,
      rect: { x: 40, y: 0, width: 60, height: 80 },
    },
    {
      id: 'horizontal',
      direction: 'down',
      ratio: 0.25,
      rect: { x: 0, y: 20, width: 100, height: 60 },
    },
  ],
};

describe('split handle ratio model', () => {
  it('clamps ratios to safe layout bounds', () => {
    expect(clampSplitRatio(-1)).toBe(0.1);
    expect(clampSplitRatio(0.45)).toBe(0.45);
    expect(clampSplitRatio(2)).toBe(0.9);
  });

  it('maps pointer coordinates through the outer layout into a nested split', () => {
    expect(
      ratioFromPointer(
        layout.splits[0],
        layout.area,
        { left: 100, top: 50, width: 500, height: 400 },
        { clientX: 450, clientY: 100 },
      ),
    ).toBe(0.5);
    expect(
      ratioFromPointer(
        layout.splits[1],
        layout.area,
        { left: 100, top: 50, width: 500, height: 400 },
        { clientX: 100, clientY: 300 },
      ),
    ).toBe(0.5);
  });

  it('maps keyboard arrows, Home, and End to safe directional ratios', () => {
    expect(keyboardSplitRatio(0.5, 'right', 'ArrowRight')).toBe(0.55);
    expect(keyboardSplitRatio(0.5, 'right', 'ArrowUp')).toBeNull();
    expect(keyboardSplitRatio(0.88, 'right', 'ArrowRight')).toBe(0.9);
    expect(keyboardSplitRatio(0.5, 'down', 'ArrowUp')).toBe(0.45);
    expect(keyboardSplitRatio(0.5, 'down', 'Home')).toBe(0.1);
    expect(keyboardSplitRatio(0.5, 'down', 'End')).toBe(0.9);
  });

  it('positions handles from canonical split rectangles', () => {
    expect(splitHandlePosition(layout.splits[0], layout.area)).toEqual({
      leftPercent: 70,
      topPercent: 0,
      widthPercent: 0,
      heightPercent: 100,
    });
    expect(splitHandlePosition(layout.splits[1], layout.area)).toEqual({
      leftPercent: 0,
      topPercent: 43.75,
      widthPercent: 100,
      heightPercent: 0,
    });
  });
});
