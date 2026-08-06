import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CompactShellControls } from '@/renderer/responsive/CompactShellControls';
import { snapshot } from '@/renderer/responsive/test-fixtures';

describe('CompactShellControls', () => {
  it('renders controlled keyboard tabs with canonical counts and attention', async () => {
    const user = userEvent.setup();
    const onSectionChange = vi.fn();
    render(
      <CompactShellControls
        activeSection="agents"
        onSectionChange={onSectionChange}
        snapshot={snapshot}
      />,
    );

    const agents = screen.getByRole('tab', { name: 'Agents, 2 total, 2 attention' });
    expect(agents).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Spaces, 2 total' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tabs, 2 total' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Menu' })).toBeInTheDocument();

    agents.focus();
    await user.keyboard('{ArrowRight}');
    expect(onSectionChange).toHaveBeenCalledWith('spaces');
  });

  it('reports direct section activation without owning the active section', async () => {
    const user = userEvent.setup();
    const onSectionChange = vi.fn();
    render(
      <CompactShellControls
        activeSection="tabs"
        onSectionChange={onSectionChange}
        snapshot={snapshot}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Menu' }));
    expect(onSectionChange).toHaveBeenCalledWith('menu');
    expect(screen.getByRole('tab', { name: 'Tabs, 2 total' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
