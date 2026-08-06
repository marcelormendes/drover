import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('keeps icon controls centered and inside their allocated toolbar footprint', () => {
    render(
      <Button aria-label="Toolbar action" size="icon" variant="neutral">
        <svg aria-hidden="true" />
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Toolbar action' })).toHaveClass(
      'shrink-0',
      'shadow-none!',
      'hover:translate-x-0!',
      'hover:translate-y-0!',
    );
  });
});
