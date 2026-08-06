import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SplitHandles } from '@/renderer/panes/SplitHandles';
import type { PaneLayoutSnapshot } from '@/shared/herdr';

const layout: PaneLayoutSnapshot = {
  workspace_id: 'w1',
  tab_id: 't1',
  zoomed: false,
  area: { x: 0, y: 0, width: 100, height: 100 },
  focused_pane_id: 'p1',
  panes: [],
  splits: [
    {
      id: 'vertical',
      direction: 'right',
      ratio: 0.5,
      rect: { x: 0, y: 0, width: 100, height: 100 },
    },
    {
      id: 'horizontal',
      direction: 'down',
      ratio: 0.25,
      rect: { x: 0, y: 0, width: 100, height: 50 },
    },
  ],
};

describe('SplitHandles', () => {
  it('renders accessible directional separators and emits keyboard ratios', () => {
    const onRatioChange = vi.fn();
    render(<SplitHandles layout={layout} onRatioChange={onRatioChange} />);

    const vertical = screen.getByRole('separator', { name: 'Resize vertical split' });
    const horizontal = screen.getByRole('separator', { name: 'Resize horizontal split' });
    expect(vertical).toHaveAttribute('aria-orientation', 'vertical');
    expect(horizontal).toHaveAttribute('aria-orientation', 'horizontal');

    fireEvent.keyDown(vertical, { key: 'ArrowRight' });
    fireEvent.keyDown(horizontal, { key: 'End' });

    expect(onRatioChange).toHaveBeenNthCalledWith(1, { splitId: 'vertical', ratio: 0.55 });
    expect(onRatioChange).toHaveBeenNthCalledWith(2, { splitId: 'horizontal', ratio: 0.9 });
  });

  it('maps pointer movement through the rendered layout bounds', () => {
    const onRatioChange = vi.fn();
    render(
      <SplitHandles
        layout={{ ...layout, splits: [layout.splits[0]] }}
        onRatioChange={onRatioChange}
      />,
    );

    const surface = screen.getByTestId('split-handles');
    Object.defineProperty(surface, 'getBoundingClientRect', {
      value: () => ({
        left: 10,
        top: 20,
        width: 200,
        height: 100,
        right: 210,
        bottom: 120,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }),
    });
    const separator = screen.getByRole('separator', { name: 'Resize vertical split' });
    fireEvent.pointerDown(separator, { buttons: 1, clientX: 170, clientY: 40 });
    fireEvent.pointerMove(separator, { buttons: 1, clientX: 190, clientY: 40 });

    expect(onRatioChange).toHaveBeenNthCalledWith(1, { splitId: 'vertical', ratio: 0.8 });
    expect(onRatioChange).toHaveBeenNthCalledWith(2, { splitId: 'vertical', ratio: 0.9 });
  });
});
