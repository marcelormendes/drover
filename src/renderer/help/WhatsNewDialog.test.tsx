import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WhatsNewDialog } from '@/renderer/help/WhatsNewDialog';

describe('WhatsNewDialog', () => {
  it('shows desktop release notes and offers Herdr live handoff when restart is needed', async () => {
    const user = userEvent.setup();
    const onLiveHandoff = vi.fn();
    render(
      <WhatsNewDialog
        canLiveHandoff
        onLiveHandoff={onLiveHandoff}
        onOpenChange={vi.fn()}
        open
        restartNeeded
        version="0.1.5"
      />,
    );

    expect(screen.getByRole('heading', { name: "What's new in 0.1.5" })).toBeInTheDocument();
    expect(screen.getByText('Complete graphical Herdr control')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restart Herdr without losing session' }));
    expect(onLiveHandoff).toHaveBeenCalledOnce();
  });
});
