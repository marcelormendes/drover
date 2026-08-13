import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ShortcutHelpDialog } from '@/renderer/help/ShortcutHelpDialog';

describe('ShortcutHelpDialog', () => {
  it('lists desktop equivalents for Herdr actions and filters by action or key', async () => {
    const user = userEvent.setup();
    render(<ShortcutHelpDialog onOpenChange={vi.fn()} open />);

    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('Open Navigator')).toBeInTheDocument();
    expect(screen.getByText('Focus pane left')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search shortcuts'), 'split');
    expect(screen.getByText('Split pane right')).toBeInTheDocument();
    expect(screen.getByText('Split pane down')).toBeInTheDocument();
    expect(screen.queryByText('Open Navigator')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search shortcuts'));
    await user.type(screen.getByLabelText('Search shortcuts'), '⌘K');
    expect(screen.getByText('Open Navigator')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search shortcuts'));
    await user.type(screen.getByLabelText('Search shortcuts'), 'zoom');
    expect(screen.getByText('Zoom in')).toBeInTheDocument();
    expect(screen.getByText('Zoom out')).toBeInTheDocument();
    expect(screen.getByText('Reset zoom')).toBeInTheDocument();
    expect(screen.getByText('Toggle pane zoom')).toBeInTheDocument();
  });
});
