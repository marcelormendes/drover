import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';

import {
  keyboardSplitRatio,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  ratioFromPointer,
  splitHandlePosition,
} from '@/renderer/panes/split-handles-model';
import type { PaneLayoutSnapshot } from '@/shared/herdr';

export interface SplitRatioIntent {
  splitId: string;
  ratio: number;
}

export interface SplitHandlesProps {
  layout: PaneLayoutSnapshot;
  onRatioChange: (intent: SplitRatioIntent) => void;
  disabled?: boolean;
  keyboardStep?: number;
}

export function SplitHandles({
  layout,
  onRatioChange,
  disabled = false,
  keyboardStep = 0.05,
}: SplitHandlesProps) {
  const emitPointerRatio = (
    event: PointerEvent<HTMLElement>,
    split: PaneLayoutSnapshot['splits'][number],
  ) => {
    if (disabled) {
      return;
    }
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    onRatioChange({
      splitId: split.id,
      ratio: ratioFromPointer(split, layout.area, bounds, event),
    });
  };

  const emitKeyboardRatio = (
    event: KeyboardEvent<HTMLElement>,
    split: PaneLayoutSnapshot['splits'][number],
  ) => {
    if (disabled) {
      return;
    }
    const ratio = keyboardSplitRatio(split.ratio, split.direction, event.key, keyboardStep);
    if (ratio === null) {
      return;
    }
    event.preventDefault();
    onRatioChange({ splitId: split.id, ratio });
  };

  return (
    <div className="pointer-events-none absolute inset-0" data-testid="split-handles">
      {layout.splits.map((split) => {
        const position = splitHandlePosition(split, layout.area);
        const vertical = split.direction === 'right';
        const style: CSSProperties = vertical
          ? {
              left: `${position.leftPercent}%`,
              top: `${position.topPercent}%`,
              width: '12px',
              height: `${position.heightPercent}%`,
              transform: 'translateX(-50%)',
            }
          : {
              left: `${position.leftPercent}%`,
              top: `${position.topPercent}%`,
              width: `${position.widthPercent}%`,
              height: '12px',
              transform: 'translateY(-50%)',
            };
        return (
          <hr
            aria-label={`Resize ${vertical ? 'vertical' : 'horizontal'} split`}
            aria-orientation={vertical ? 'vertical' : 'horizontal'}
            aria-valuemax={MAX_SPLIT_RATIO}
            aria-valuemin={MIN_SPLIT_RATIO}
            aria-valuenow={split.ratio}
            className={
              vertical
                ? 'pointer-events-auto absolute cursor-col-resize border-l-2 border-transparent hover:border-border focus-visible:border-border focus-visible:outline-hidden'
                : 'pointer-events-auto absolute cursor-row-resize border-t-2 border-transparent hover:border-border focus-visible:border-border focus-visible:outline-hidden'
            }
            data-split-id={split.id}
            key={split.id}
            onKeyDown={(event) => emitKeyboardRatio(event, split)}
            onPointerDown={(event) => emitPointerRatio(event, split)}
            onPointerMove={(event) => {
              if (event.buttons === 1) {
                emitPointerRatio(event, split);
              }
            }}
            style={style}
            tabIndex={disabled ? -1 : 0}
          />
        );
      })}
    </div>
  );
}
