import type { LayoutRect, PaneLayoutSnapshot } from '@/shared/herdr';

export const MIN_SPLIT_RATIO = 0.1;
export const MAX_SPLIT_RATIO = 0.9;

export interface PointerBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PointerPosition {
  clientX: number;
  clientY: number;
}

export interface SplitHandlePosition {
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
}

export type LayoutSplit = PaneLayoutSnapshot['splits'][number];

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return 0.5;
  }
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, Number(ratio.toFixed(4))));
}

export function ratioFromPointer(
  split: LayoutSplit,
  layoutArea: LayoutRect,
  bounds: PointerBounds,
  pointer: PointerPosition,
): number {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return clampSplitRatio(split.ratio);
  }
  const layoutX =
    layoutArea.x + ((pointer.clientX - bounds.left) / bounds.width) * layoutArea.width;
  const layoutY =
    layoutArea.y + ((pointer.clientY - bounds.top) / bounds.height) * layoutArea.height;
  const ratio =
    split.direction === 'right'
      ? (layoutX - split.rect.x) / split.rect.width
      : (layoutY - split.rect.y) / split.rect.height;
  return clampSplitRatio(ratio);
}

export function keyboardSplitRatio(
  ratio: number,
  direction: LayoutSplit['direction'],
  key: string,
  step = 0.05,
): number | null {
  if (key === 'Home') {
    return MIN_SPLIT_RATIO;
  }
  if (key === 'End') {
    return MAX_SPLIT_RATIO;
  }
  const delta =
    direction === 'right'
      ? key === 'ArrowLeft'
        ? -step
        : key === 'ArrowRight'
          ? step
          : null
      : key === 'ArrowUp'
        ? -step
        : key === 'ArrowDown'
          ? step
          : null;
  return delta === null ? null : clampSplitRatio(ratio + delta);
}

export function splitHandlePosition(
  split: LayoutSplit,
  layoutArea: LayoutRect,
): SplitHandlePosition {
  if (layoutArea.width <= 0 || layoutArea.height <= 0) {
    return { leftPercent: 0, topPercent: 0, widthPercent: 0, heightPercent: 0 };
  }
  const left = ((split.rect.x - layoutArea.x) / layoutArea.width) * 100;
  const top = ((split.rect.y - layoutArea.y) / layoutArea.height) * 100;
  const width = (split.rect.width / layoutArea.width) * 100;
  const height = (split.rect.height / layoutArea.height) * 100;
  return split.direction === 'right'
    ? {
        leftPercent: left + width * split.ratio,
        topPercent: top,
        widthPercent: 0,
        heightPercent: height,
      }
    : {
        leftPercent: left,
        topPercent: top + height * split.ratio,
        widthPercent: width,
        heightPercent: 0,
      };
}
