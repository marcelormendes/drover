import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';

describe('cn', () => {
  it('merges conditional classes and resolves Tailwind conflicts', () => {
    expect(cn('px-2', false && 'hidden', ['font-base', 'px-4'])).toBe('font-base px-4');
  });
});
