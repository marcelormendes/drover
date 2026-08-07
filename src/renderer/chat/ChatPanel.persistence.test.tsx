import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ChatPanel,
  type ChatSessionState,
  createChatSessionState,
} from '@/renderer/chat/ChatPanel';
import type { PaneInfo } from '@/shared/herdr';

const pane: PaneInfo = {
  pane_id: 'w1:p1',
  terminal_id: 'terminal-1',
  workspace_id: 'w1',
  tab_id: 'w1:t1',
  focused: true,
  agent: 'pi',
  display_agent: 'Pi',
  agent_status: 'idle',
  state_labels: {},
  tokens: {},
  revision: 1,
};

function PersistentHarness() {
  const [visible, setVisible] = useState(true);
  const [session, setSession] = useState<ChatSessionState>(createChatSessionState);
  return (
    <>
      <button onClick={() => setVisible((current) => !current)} type="button">
        Toggle pane
      </button>
      {visible ? (
        <ChatPanel
          onPrompt={vi.fn()}
          onSessionChange={setSession}
          pane={pane}
          readOutput={vi.fn(async () => ({
            type: 'pane-output' as const,
            paneId: 'w1:p1',
            workspaceId: 'w1',
            tabId: 'w1:t1',
            text: 'Ready',
            revision: 1,
            truncated: false,
          }))}
          session={session}
        />
      ) : null}
    </>
  );
}

describe('ChatPanel controlled session', () => {
  it('preserves the conversation when a pane unmounts during navigation', async () => {
    const user = userEvent.setup();
    render(<PersistentHarness />);
    await user.type(screen.getByRole('textbox', { name: 'Message Pi' }), 'Keep this turn');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(screen.getByText('Keep this turn')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Toggle pane' }));
    expect(screen.queryByRole('textbox', { name: 'Message Pi' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Toggle pane' }));

    expect(screen.getByText('Keep this turn')).toBeInTheDocument();
  });

  it('preserves pasted images when a pane unmounts during tab navigation', async () => {
    const user = userEvent.setup();
    render(<PersistentHarness />);
    const image = new File(['image-bytes'], 'portrait.png', { type: 'image/png' });

    fireEvent.paste(screen.getByRole('textbox', { name: 'Message Pi' }), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        files: [image],
      },
    });

    expect(await screen.findByRole('img', { name: 'portrait.png' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Toggle pane' }));
    await user.click(screen.getByRole('button', { name: 'Toggle pane' }));

    expect(screen.getByRole('img', { name: 'portrait.png' })).toBeInTheDocument();
  });
});
