import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReorderControls } from '@/renderer/navigation/ReorderControls';

describe('ReorderControls', () => {
  it('provides named keyboard buttons and reports an available direction', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    render(
      <ReorderControls canMoveDown canMoveUp={false} label="workspace Desktop" onMove={onMove} />,
    );

    expect(screen.getByRole('button', { name: 'Move workspace Desktop up' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move workspace Desktop down' }));

    expect(onMove).toHaveBeenCalledWith('down');
  });
});
