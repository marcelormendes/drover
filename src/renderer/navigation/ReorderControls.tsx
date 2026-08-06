import { ArrowDown, ArrowUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ReorderDirection } from '@/renderer/navigation/reorder-model';

export interface ReorderControlsProps {
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: ReorderDirection) => void;
}

export function ReorderControls({ label, canMoveUp, canMoveDown, onMove }: ReorderControlsProps) {
  return (
    <fieldset className="inline-flex shrink-0 gap-1">
      <legend className="sr-only">Reorder {label}</legend>
      <Button
        aria-label={`Move ${label} up`}
        className="size-8"
        disabled={!canMoveUp}
        onClick={() => onMove('up')}
        size="icon"
        type="button"
        variant="neutral"
      >
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button
        aria-label={`Move ${label} down`}
        className="size-8"
        disabled={!canMoveDown}
        onClick={() => onMove('down')}
        size="icon"
        type="button"
        variant="neutral"
      >
        <ArrowDown aria-hidden="true" />
      </Button>
    </fieldset>
  );
}
