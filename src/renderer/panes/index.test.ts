import { describe, expect, it } from 'vitest';

import {
  clampSplitRatio,
  MovePaneDialog,
  PaneControls,
  PaneDetails,
  SplitHandles,
} from '@/renderer/panes';

describe('pane renderer public surface', () => {
  it('exports the App-independent controls, details, and split helpers', () => {
    expect(PaneControls).toBeTypeOf('function');
    expect(MovePaneDialog).toBeTypeOf('function');
    expect(PaneDetails).toBeTypeOf('function');
    expect(SplitHandles).toBeTypeOf('function');
    expect(clampSplitRatio).toBeTypeOf('function');
  });
});
