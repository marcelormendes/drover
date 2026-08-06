import { describe, expect, it } from 'vitest';

import {
  buildMobileSwitcherModel,
  CompactShellControls,
  MobileSwitcher,
} from '@/renderer/responsive';

describe('responsive renderer public surface', () => {
  it('exports the controlled compact shell surfaces and model', () => {
    expect(MobileSwitcher).toBeTypeOf('function');
    expect(CompactShellControls).toBeTypeOf('function');
    expect(buildMobileSwitcherModel).toBeTypeOf('function');
  });
});
