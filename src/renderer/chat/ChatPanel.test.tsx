import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChatPanel } from '@/renderer/chat/ChatPanel';
import type { PaneInfo } from '@/shared/herdr';

const pane: PaneInfo = {
  pane_id: 'w1:p1',
  terminal_id: 'terminal-1',
  workspace_id: 'w1',
  tab_id: 'w1:t1',
  focused: true,
  cwd: '/code/herdr-desktop',
  label: 'Desktop implementation',
  agent: 'codex',
  display_agent: 'Codex',
  agent_status: 'working',
  state_labels: { working: 'Building chat' },
  tokens: {},
  revision: 42,
};

describe('ChatPanel', () => {
  it('renders a themed conversation and sends prompts through Herdr', async () => {
    const user = userEvent.setup();
    const onPrompt = vi.fn(async () => undefined);
    const readOutput = vi.fn(async () => ({
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: 'The chat surface is ready.',
      revision: 42,
      truncated: false,
    }));

    render(<ChatPanel onPrompt={onPrompt} pane={pane} readOutput={readOutput} />);

    expect(screen.getByRole('heading', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Conversation with Codex' })).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(screen.getByText('working')).toBeInTheDocument();
    expect(await screen.findByText('The chat surface is ready.')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Message Codex' }), 'Polish the header');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onPrompt).toHaveBeenCalledWith('w1:p1', 'Polish the header');
    const userMessage = screen.getByText('Polish the header').closest('article');
    expect(userMessage).toHaveClass('bg-main', 'border-border');
    expect(screen.getByRole('textbox', { name: 'Message Codex' })).toHaveValue('');
  });

  it('offers the terminal fallback when an agent is blocked', async () => {
    const onOpenTerminal = vi.fn();
    render(
      <ChatPanel
        onOpenTerminal={onOpenTerminal}
        onPrompt={vi.fn()}
        pane={{ ...pane, agent_status: 'blocked' }}
        readOutput={vi.fn(async () => ({
          type: 'pane-output' as const,
          paneId: 'w1:p1',
          workspaceId: 'w1',
          tabId: 'w1:t1',
          text: 'Approval needed.',
          revision: 43,
          truncated: false,
        }))}
      />,
    );

    expect(await screen.findByText('This agent needs attention.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open terminal' }));
    expect(onOpenTerminal).toHaveBeenCalledOnce();
  });

  it('sends with Enter and keeps Shift+Enter for multiline prompts', async () => {
    const user = userEvent.setup();
    const onPrompt = vi.fn(async () => undefined);
    render(
      <ChatPanel
        onPrompt={onPrompt}
        pane={pane}
        readOutput={vi.fn(async () => ({
          type: 'pane-output' as const,
          paneId: 'w1:p1',
          workspaceId: 'w1',
          tabId: 'w1:t1',
          text: 'Ready',
          revision: 42,
          truncated: false,
        }))}
      />,
    );

    const composer = screen.getByRole('textbox', { name: 'Message Codex' });
    await user.type(composer, 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(composer).toHaveValue('Line one\nLine two');
    expect(onPrompt).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onPrompt).toHaveBeenCalledWith('w1:p1', 'Line one\nLine two');
  });

  it('renders new agent output after its matching user turn', async () => {
    const user = userEvent.setup();
    const readOutput = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'pane-output' as const,
        paneId: 'w1:p1',
        workspaceId: 'w1',
        tabId: 'w1:t1',
        text: 'Previous terminal output',
        revision: 42,
        truncated: false,
      })
      .mockResolvedValue({
        type: 'pane-output' as const,
        paneId: 'w1:p1',
        workspaceId: 'w1',
        tabId: 'w1:t1',
        text: 'The requested change is complete.',
        revision: 43,
        truncated: false,
      });
    const { rerender } = render(
      <ChatPanel onPrompt={vi.fn()} pane={pane} readOutput={readOutput} />,
    );
    await screen.findByText('Previous terminal output');
    await user.type(screen.getByRole('textbox', { name: 'Message Codex' }), 'Make the change');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    rerender(
      <ChatPanel onPrompt={vi.fn()} pane={{ ...pane, revision: 43 }} readOutput={readOutput} />,
    );

    const userText = screen.getByText('Make the change');
    const responseText = await screen.findByText('The requested change is complete.');
    expect(
      userText.compareDocumentPosition(responseText) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText('Previous terminal output')).not.toBeInTheDocument();

    rerender(
      <ChatPanel
        onPrompt={vi.fn()}
        pane={{ ...pane, agent_status: 'idle', revision: 43 }}
        readOutput={readOutput}
      />,
    );
    await waitFor(() =>
      expect(
        within(responseText.closest('article') as HTMLElement).getByText('idle'),
      ).toBeVisible(),
    );
  });

  it('keeps reading an open turn when the agent finishes before a working status is observed', async () => {
    const user = userEvent.setup();
    const readOutput = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'pane-output' as const,
        paneId: 'w1:p1',
        workspaceId: 'w1',
        tabId: 'w1:t1',
        text: 'Ready',
        revision: 42,
        truncated: false,
      })
      .mockResolvedValue({
        type: 'pane-output' as const,
        paneId: 'w1:p1',
        workspaceId: 'w1',
        tabId: 'w1:t1',
        text: 'Fast idle reply',
        revision: 42,
        truncated: false,
      });

    render(
      <ChatPanel
        onPrompt={vi.fn(async () => undefined)}
        pane={{ ...pane, agent_status: 'idle' }}
        readOutput={readOutput}
      />,
    );
    await screen.findByText('Ready');
    await user.type(screen.getByRole('textbox', { name: 'Message Codex' }), 'Answer quickly');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Fast idle reply')).toBeInTheDocument();
    expect(readOutput.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the latest successful output visible when a refresh fails', async () => {
    const readOutput = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'pane-output' as const,
        paneId: 'w1:p1',
        workspaceId: 'w1',
        tabId: 'w1:t1',
        text: 'Stable answer',
        revision: 42,
        truncated: false,
      })
      .mockRejectedValueOnce(new Error('temporary read failure'));
    const { rerender } = render(
      <ChatPanel onPrompt={vi.fn()} pane={pane} readOutput={readOutput} />,
    );
    expect(await screen.findByText('Stable answer')).toBeInTheDocument();

    rerender(
      <ChatPanel onPrompt={vi.fn()} pane={{ ...pane, revision: 43 }} readOutput={readOutput} />,
    );

    await waitFor(() => expect(readOutput).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Stable answer')).toBeInTheDocument();
    expect(screen.getByText('Live output could not refresh.')).toBeInTheDocument();
  });
});
