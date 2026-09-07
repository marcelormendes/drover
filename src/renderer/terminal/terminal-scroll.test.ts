import { describe, expect, it } from 'vitest';
import {
  createTerminalWheelAccumulator,
  terminalWheelModifiers,
  terminalWheelPosition,
} from '@/renderer/terminal/terminal-scroll';

describe('terminal wheel pointer coordinates', () => {
  const screen = { left: 112, top: 64, width: 800, height: 480 };

  it('uses the screen origin instead of pane padding and supports fractional CSS cell widths', () => {
    expect(terminalWheelPosition(152, 124, screen, 80, 24)).toEqual({ column: 4, row: 3 });
    expect(terminalWheelPosition(112, 64, screen, 80, 24)).toEqual({ column: 0, row: 0 });
    expect(terminalWheelPosition(126.9, 94, { ...screen, width: 600 }, 80, 24)).toEqual({
      column: 1,
      row: 1,
    });
  });

  it('clamps pointer positions in surrounding padding to the nearest terminal cell', () => {
    expect(terminalWheelPosition(100, 50, screen, 80, 24)).toEqual({ column: 0, row: 0 });
    expect(terminalWheelPosition(1000, 600, screen, 80, 24)).toEqual({ column: 79, row: 23 });
    expect(terminalWheelPosition(912, 544, screen, 80, 24)).toEqual({ column: 79, row: 23 });
  });

  it('does not invent coordinates for hidden or unmeasured screens', () => {
    expect(terminalWheelPosition(120, 80, { ...screen, width: 0 }, 80, 24)).toBeUndefined();
    expect(terminalWheelPosition(120, 80, screen, 0, 24)).toBeUndefined();
    expect(terminalWheelPosition(Number.NaN, 80, screen, 80, 24)).toBeUndefined();
  });

  it('preserves public engine modifier bits', () => {
    expect(
      terminalWheelModifiers({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }),
    ).toBe(0);
    expect(
      terminalWheelModifiers({ shiftKey: true, ctrlKey: true, altKey: true, metaKey: true }),
    ).toBe(15);
    expect(
      terminalWheelModifiers({ shiftKey: false, ctrlKey: true, altKey: false, metaKey: false }),
    ).toBe(2);
  });
});

describe('terminal wheel accumulation', () => {
  it('keeps high-resolution trackpad movement proportional across animation frames', () => {
    const wheel = createTerminalWheelAccumulator();
    for (let index = 0; index < 39; index += 1) {
      wheel.add(1, 0, 24);
      expect(wheel.takeLines()).toBe(0);
    }
    wheel.add(1, 0, 24);
    expect(wheel.takeLines()).toBe(1);
    expect(wheel.takeLines()).toBe(0);
  });

  it('gives equal distance for a large event and equivalent small events', () => {
    const coarse = createTerminalWheelAccumulator();
    const fine = createTerminalWheelAccumulator();
    coarse.add(-120, 0, 24);
    let fineLines = 0;
    for (let index = 0; index < 120; index += 1) {
      fine.add(-1, 0, 24);
      fineLines += fine.takeLines();
    }
    expect(coarse.takeLines()).toBe(-3);
    expect(fineLines).toBe(-3);
  });

  it('normalizes line and page wheel modes and retains a fractional remainder', () => {
    const wheel = createTerminalWheelAccumulator();
    wheel.add(0.5, 1, 24);
    expect(wheel.takeLines()).toBe(0);
    wheel.add(20, 0, 24);
    expect(wheel.takeLines()).toBe(1);
    wheel.add(-2, 1, 24);
    expect(wheel.takeLines()).toBe(-2);
    wheel.add(1, 2, 36);
    expect(wheel.takeLines()).toBe(36);
  });

  it('cancels opposite sub-line movement instead of turning each direction into a line', () => {
    const wheel = createTerminalWheelAccumulator();
    wheel.add(30, 0, 24);
    wheel.add(-10, 0, 24);
    expect(wheel.takeLines()).toBe(0);
    wheel.add(20, 0, 24);
    expect(wheel.takeLines()).toBe(1);
  });

  it('drops fractional carry when a pane is replaced or its accumulator resets', () => {
    const oldPane = createTerminalWheelAccumulator();
    oldPane.add(30, 0, 24);
    const newPane = createTerminalWheelAccumulator();
    newPane.add(10, 0, 24);
    expect(newPane.takeLines()).toBe(0);
    oldPane.reset();
    oldPane.add(10, 0, 24);
    expect(oldPane.takeLines()).toBe(0);
  });

  it('ignores invalid event units and bounds requests to the engine limit', () => {
    const wheel = createTerminalWheelAccumulator();
    wheel.add(Number.NaN, 0, 24);
    wheel.add(100, 3, 24);
    wheel.add(1, 2, Number.NaN);
    expect(wheel.takeLines()).toBe(0);
    wheel.add(Number.MAX_VALUE, 0, 24);
    expect(wheel.takeLines()).toBe(65_535);
    wheel.add(-Number.MAX_VALUE, 0, 24);
    expect(wheel.takeLines()).toBe(-65_535);
  });
});
