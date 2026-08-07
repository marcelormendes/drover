import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChatPanel } from '@/renderer/chat/ChatPanel';
import { MAX_CHAT_IMAGE_ATTACHMENTS, MAX_CHAT_IMAGE_BYTES } from '@/shared/desktop-api';
import type { PaneInfo } from '@/shared/herdr';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
  it('uses distinct readable colors for thinking and final response text', async () => {
    const readOutput = vi.fn(async () => ({
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: 'I need to inspect the current theme.\n\nThe palette is ready.',
      revision: 43,
      truncated: false,
    }));

    render(
      <ChatPanel
        onPrompt={vi.fn(async () => undefined)}
        pane={{ ...pane, agent_status: 'idle' }}
        readOutput={readOutput}
      />,
    );

    const thinking = await screen.findByText('I need to inspect the current theme.');
    const response = screen.getByText('The palette is ready.');

    expect(thinking).toHaveClass('border-main', 'text-thinking-foreground');
    expect(thinking).not.toHaveClass('opacity-45');
    expect(response).toHaveClass('text-response-foreground');
  });

  it('refreshes idle chat immediately when Herdr reports pane activity', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    const originalHerdr = window.herdr;
    window.herdr = {
      onSessionEvent: vi.fn((listener) => {
        sessionEvent = listener;
        return () => undefined;
      }),
    } as unknown as typeof window.herdr;
    let currentText = 'Ready';
    let currentRevision = 1;
    const readOutput = vi.fn(async () => ({
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: currentText,
      revision: currentRevision,
      truncated: false,
    }));

    render(
      <ChatPanel
        onPrompt={vi.fn()}
        pane={{ ...pane, agent_status: 'idle' }}
        readOutput={readOutput}
      />,
    );
    await screen.findByText('Ready');
    currentText = 'Terminal output started before status detection.';
    currentRevision = 2;

    act(() => {
      sessionEvent?.({ event: 'pane.scroll_changed', data: { pane_id: 'w1:p1' } });
    });

    expect(await screen.findByText(currentText)).toBeInTheDocument();
    expect(readOutput).toHaveBeenCalledTimes(2);
    window.herdr = originalHerdr;
  });

  it('follows growing output until the user scrolls up', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    const originalHerdr = window.herdr;
    window.herdr = {
      onSessionEvent: vi.fn((listener) => {
        sessionEvent = listener;
        return () => undefined;
      }),
    } as unknown as typeof window.herdr;
    let currentText = 'First line';
    let currentRevision = 1;
    const readOutput = vi.fn(async () => ({
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: currentText,
      revision: currentRevision,
      truncated: false,
    }));

    render(
      <ChatPanel
        onPrompt={vi.fn()}
        pane={{ ...pane, agent_status: 'idle' }}
        readOutput={readOutput}
      />,
    );
    await screen.findByText('First line');
    const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) {
      throw new Error('Chat scroll viewport was not rendered.');
    }
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 800, writable: true },
    });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;

    currentText = 'Second line from the model';
    currentRevision = 2;
    act(() => {
      sessionEvent?.({ event: 'pane.scroll_changed', data: { pane_id: 'w1:p1' } });
    });
    await screen.findByText(currentText);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 1_000 }));

    scrollTo.mockClear();
    viewport.scrollTop = 500;
    fireEvent.wheel(viewport, { deltaY: -300 });
    fireEvent.scroll(viewport);
    currentText = 'Third line while reading history';
    currentRevision = 3;
    act(() => {
      sessionEvent?.({ event: 'pane.scroll_changed', data: { pane_id: 'w1:p1' } });
    });
    await screen.findByText(currentText);
    expect(scrollTo).not.toHaveBeenCalled();
    window.herdr = originalHerdr;
  });

  it('keeps following after content growth emits a scroll event', async () => {
    let sessionEvent:
      | ((event: { event: string; data: Record<string, unknown> }) => void)
      | undefined;
    const originalHerdr = window.herdr;
    window.herdr = {
      onSessionEvent: vi.fn((listener) => {
        sessionEvent = listener;
        return () => undefined;
      }),
    } as unknown as typeof window.herdr;
    let currentText = 'First line';
    let currentRevision = 1;
    const readOutput = vi.fn(async () => ({
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: currentText,
      revision: currentRevision,
      truncated: false,
    }));

    render(
      <ChatPanel
        onPrompt={vi.fn()}
        pane={{ ...pane, agent_status: 'idle' }}
        readOutput={readOutput}
      />,
    );
    await screen.findByText('First line');
    const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) {
      throw new Error('Chat scroll viewport was not rendered.');
    }
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 800, writable: true },
    });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;

    // Chromium can emit scroll while streamed content changes its layout.
    // Without user scroll intent, that must not disable auto-follow.
    viewport.scrollTop = 500;
    fireEvent.scroll(viewport);
    currentText = 'Second line after a large streamed layout change';
    currentRevision = 2;
    act(() => {
      sessionEvent?.({ event: 'pane.scroll_changed', data: { pane_id: 'w1:p1' } });
    });

    await screen.findByText(currentText);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 1_000 }));
    window.herdr = originalHerdr;
  });

  it('constrains streamed content to a narrow pane instead of widening the Radix viewport', async () => {
    render(
      <ChatPanel
        onPrompt={vi.fn()}
        pane={{ ...pane, agent_status: 'idle' }}
        readOutput={vi.fn(async () => ({
          type: 'pane-output' as const,
          paneId: 'w1:p1',
          workspaceId: 'w1',
          tabId: 'w1:t1',
          text: `wide-${'x'.repeat(240)}`,
          revision: 43,
          truncated: false,
        }))}
      />,
    );

    await screen.findByText(/wide-/);
    const viewport = document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    expect(viewport).toHaveClass('[&>div]:!block', '[&>div]:min-w-0', '[&>div]:max-w-full');
    expect(screen.getByRole('log', { name: 'Conversation with Codex' })).toHaveClass(
      'min-w-0',
      'max-w-full',
      'overflow-hidden',
    );
  });

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
    const initialReply = await screen.findByText('The chat surface is ready.');
    expect(initialReply).toBeInTheDocument();
    expect(initialReply.closest('[data-slot="agent-reply"]')).toHaveClass('min-w-0', 'max-w-full');

    await user.type(screen.getByRole('textbox', { name: 'Message Codex' }), 'Polish the header');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onPrompt).toHaveBeenCalledWith('w1:p1', 'Polish the header');
    const userMessage = screen.getByText('Polish the header').closest('article');
    expect(userMessage).toHaveClass(
      'bg-accent-surface',
      'border-main',
      'text-accent-surface-foreground',
    );
    expect(screen.getByRole('textbox', { name: 'Message Codex' })).toHaveValue('');
  });

  it('sends slash commands as typed pane input so the agent CLI handles them', async () => {
    const user = userEvent.setup();
    const onPrompt = vi.fn(async () => undefined);
    const onSendInput = vi.fn(async () => undefined);
    const readOutput = vi.fn(async () => ({
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: 'ready',
      revision: 1,
      truncated: false,
    }));

    render(
      <ChatPanel
        onPrompt={onPrompt}
        onSendInput={onSendInput}
        pane={pane}
        readOutput={readOutput}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Message Codex' }), '/compact');
    expect(await screen.findByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSendInput).toHaveBeenCalledWith('w1:p1', { text: '/compact', keys: ['enter'] });
    expect(onPrompt).not.toHaveBeenCalled();
    expect(screen.getByText('/compact')).toBeInTheDocument();
  });

  it('renders CLI selection menus as clickable options and answers with key presses', async () => {
    const user = userEvent.setup();
    const onSendInput = vi.fn(async () => undefined);
    const readOutput = vi.fn(async () => ({
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: ['>', '', '→ deepseek-v4-flash [opencode-go] ✓', '  k3 [kimi-coding]', '  (1/30)'].join(
        '\n',
      ),
      revision: 7,
      truncated: false,
    }));

    render(
      <ChatPanel
        onPrompt={vi.fn()}
        onSendInput={onSendInput}
        pane={pane}
        readOutput={readOutput}
      />,
    );

    await screen.findByText('Codex is asking you to choose');
    expect(screen.getByText('1/30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /k3 \[kimi-coding\]/ }));
    expect(onSendInput).toHaveBeenCalledWith('w1:p1', { keys: ['down', 'enter'] });

    await user.click(screen.getByRole('button', { name: 'Cancel (esc)' }));
    expect(onSendInput).toHaveBeenCalledWith('w1:p1', { keys: ['esc'] });
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
    const previousOutput = {
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: 'Previous terminal output',
      revision: 42,
      truncated: false,
    };
    let releaseReply!: () => void;
    const replyGate = new Promise<void>((resolve) => {
      releaseReply = resolve;
    });
    const readOutput = vi
      .fn()
      // Initial refresh, then the fresh baseline captured at submit time.
      .mockResolvedValueOnce(previousOutput)
      .mockResolvedValueOnce(previousOutput)
      .mockImplementation(() =>
        replyGate.then(() => ({
          type: 'pane-output' as const,
          paneId: 'w1:p1',
          workspaceId: 'w1',
          tabId: 'w1:t1',
          text: 'The requested change is complete.',
          revision: 43,
          truncated: false,
        })),
      );
    const { rerender } = render(
      <ChatPanel onPrompt={vi.fn()} pane={pane} readOutput={readOutput} />,
    );
    await screen.findByText('Previous terminal output');
    await user.type(screen.getByRole('textbox', { name: 'Message Codex' }), 'Make the change');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    rerender(
      <ChatPanel onPrompt={vi.fn()} pane={{ ...pane, revision: 43 }} readOutput={readOutput} />,
    );

    // The revision-triggered refresh has started; release the reply explicitly
    // instead of racing the poll timer.
    await waitFor(() => expect(readOutput.mock.calls.length).toBeGreaterThanOrEqual(3));
    await act(async () => {
      releaseReply();
    });

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
    const readyOutput = {
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: 'Ready',
      revision: 42,
      truncated: false,
    };
    const readOutput = vi
      .fn()
      // Initial refresh, then the fresh baseline captured at submit time.
      .mockResolvedValueOnce(readyOutput)
      .mockResolvedValueOnce(readyOutput)
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

  it('finalizes a still-active turn under its own turn when the next message is sent', async () => {
    const user = userEvent.setup();
    const output = (text: string, revision: number) => ({
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text,
      revision,
      truncated: false,
    });
    let current = output('shell$\n', 1);
    const readOutput = vi.fn(async () => current);

    render(
      <ChatPanel
        onPrompt={vi.fn()}
        pane={{ ...pane, agent_status: 'idle' }}
        readOutput={readOutput}
      />,
    );
    const composer = screen.getByRole('textbox', { name: 'Message Codex' });

    await user.type(composer, 'first prompt');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    // The first reply lands only after the user already typed the follow-up.
    current = output('shell$\nreply-one-done\n', 2);
    await user.type(composer, 'second prompt');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    const replyOne = await screen.findByText('reply-one-done', undefined, { timeout: 4_000 });
    const promptTwo = screen.getByText('second prompt');
    expect(
      replyOne.compareDocumentPosition(promptTwo) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    current = output('shell$\nreply-one-done\nreply-two-done', 3);
    const replyTwo = await screen.findByText('reply-two-done', undefined, { timeout: 4_000 });
    expect(replyTwo.textContent).not.toContain('reply-one-done');
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

    // The revision change re-runs the refresh immediately, so the failure
    // surfaces deterministically without depending on the poll timer.
    expect(await screen.findByText('Live output could not refresh.')).toBeInTheDocument();
    expect(screen.getByText('Stable answer')).toBeInTheDocument();
    await waitFor(() => expect(readOutput).toHaveBeenCalledTimes(2), { timeout: 3_000 });
  });
});

function imageFile(name = 'paste.png'): File {
  return new File(['image-bytes'], name, { type: 'image/png' });
}

function clipboardWithImage(file: File) {
  return {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      files: [file],
    },
  };
}

function readOutputStub(text = 'ready') {
  return vi.fn(async () => ({
    type: 'pane-output' as const,
    paneId: 'w1:p1',
    workspaceId: 'w1',
    tabId: 'w1:t1',
    text,
    revision: 1,
    truncated: false,
  }));
}

describe('ChatPanel image attachments', () => {
  it('turns a pasted clipboard image into a removable attachment chip', async () => {
    const user = userEvent.setup();
    const onPrompt = vi.fn(async () => undefined);
    const readOutput = readOutputStub();
    render(
      <ChatPanel onPrompt={onPrompt} pane={pane} readOutput={readOutput} stageImages={vi.fn()} />,
    );

    fireEvent.paste(
      screen.getByRole('textbox', { name: 'Message Codex' }),
      clipboardWithImage(imageFile()),
    );

    const chip = await screen.findByRole('img', { name: 'paste.png' });
    expect(chip.closest('article')).toHaveAttribute('data-slot', 'attachment-chip');
    expect(within(chip.closest('article') as HTMLElement).getByText('[Image #1]')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Remove paste.png' }));
    expect(screen.queryByRole('img', { name: 'paste.png' })).not.toBeInTheDocument();
  });

  it('ignores plain-text pastes without image items', async () => {
    const user = userEvent.setup();
    const onPrompt = vi.fn(async () => undefined);
    render(<ChatPanel onPrompt={onPrompt} pane={pane} readOutput={readOutputStub()} />);

    const textbox = screen.getByRole('textbox', { name: 'Message Codex' });
    fireEvent.paste(textbox, { clipboardData: { items: [], files: [] } });
    await user.type(textbox, 'plain text');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(textbox).toHaveValue('plain text');
  });

  it('accepts dropped image files as attachments', async () => {
    render(
      <ChatPanel
        onPrompt={vi.fn()}
        pane={pane}
        readOutput={readOutputStub()}
        stageImages={vi.fn()}
      />,
    );

    const dropZone = screen.getByRole('textbox', { name: 'Message Codex' }).closest('form');
    if (!dropZone) {
      throw new Error('Chat drop zone was not rendered.');
    }
    fireEvent.drop(dropZone, { dataTransfer: { files: [imageFile('drop.png')] } });

    expect(await screen.findByRole('img', { name: 'drop.png' })).toBeInTheDocument();
  });

  it('stages pasted images, pastes their paths, and prompts the text', async () => {
    const user = userEvent.setup();
    const onPrompt = vi.fn(async () => undefined);
    const onSendInput = vi.fn(async () => undefined);
    const stageImages = vi.fn(async () => ['/tmp/herdr-desktop-chat-1.png']);
    render(
      <ChatPanel
        onPrompt={onPrompt}
        onSendInput={onSendInput}
        pane={pane}
        readOutput={readOutputStub()}
        stageImages={stageImages}
      />,
    );

    const textbox = screen.getByRole('textbox', { name: 'Message Codex' });
    fireEvent.paste(textbox, clipboardWithImage(imageFile()));
    await screen.findByRole('img', { name: 'paste.png' });
    await user.type(textbox, 'What does this show?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(stageImages).toHaveBeenCalledWith([{ extension: 'png', data: 'aW1hZ2UtYnl0ZXM=' }]);
    expect(onSendInput).toHaveBeenCalledWith('w1:p1', {
      text: '\x1b[200~/tmp/herdr-desktop-chat-1.png\x1b[201~',
    });
    expect(onPrompt).toHaveBeenCalledWith('w1:p1', '[Image #1]\n\nWhat does this show?');
    expect(screen.getByText(/What does this show/)).toHaveTextContent(
      '[Image #1] What does this show?',
    );
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'paste.png' })).not.toBeInTheDocument(),
    );
  });

  it('submits an image-only turn with its numbered image reference', async () => {
    const user = userEvent.setup();
    const onPrompt = vi.fn(async () => undefined);
    const onSendInput = vi.fn(async () => undefined);
    render(
      <ChatPanel
        onPrompt={onPrompt}
        onSendInput={onSendInput}
        pane={pane}
        readOutput={readOutputStub()}
        stageImages={vi.fn(async () => ['/tmp/staged.png'])}
      />,
    );

    fireEvent.paste(
      screen.getByRole('textbox', { name: 'Message Codex' }),
      clipboardWithImage(imageFile()),
    );
    await screen.findByRole('img', { name: 'paste.png' });
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSendInput).toHaveBeenCalledWith('w1:p1', {
      text: '\x1b[200~/tmp/staged.png\x1b[201~',
    });
    expect(onPrompt).toHaveBeenCalledWith('w1:p1', '[Image #1]');
    expect(onSendInput).not.toHaveBeenCalledWith('w1:p1', { keys: ['enter'] });
  });

  it('keeps the attachment and reports an error when staging fails', async () => {
    const user = userEvent.setup();
    const onPrompt = vi.fn(async () => undefined);
    render(
      <ChatPanel
        onPrompt={onPrompt}
        pane={pane}
        readOutput={readOutputStub()}
        stageImages={vi.fn(async () => {
          throw new Error('disk full');
        })}
      />,
    );

    const textbox = screen.getByRole('textbox', { name: 'Message Codex' });
    fireEvent.paste(textbox, clipboardWithImage(imageFile()));
    await screen.findByRole('img', { name: 'paste.png' });
    await user.type(textbox, 'keep me');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText(/could not send this message/i)).toBeInTheDocument();
    expect(textbox).toHaveValue('');
    // The text stays in the conversation and the unstaged image stays attached.
    expect(screen.getByText(/keep me/)).toHaveTextContent('[Image #1] keep me');
    expect(screen.getByRole('img', { name: 'paste.png' })).toBeInTheDocument();
    expect(onPrompt).not.toHaveBeenCalled();
  });

  it('serializes each image paste before the prompt', async () => {
    const user = userEvent.setup();
    const onPrompt = vi.fn(async () => undefined);
    const gate = deferred<void>();
    const onSendInput = vi.fn((_paneId: string, input: { text?: string; keys?: string[] }) => {
      if (input.text?.includes('chat-1')) {
        return gate.promise;
      }
      return Promise.resolve();
    });
    const stageImages = vi.fn(async () => ['/tmp/chat-1.png', '/tmp/chat-2.png']);
    render(
      <ChatPanel
        onPrompt={onPrompt}
        onSendInput={onSendInput}
        pane={pane}
        readOutput={readOutputStub()}
        stageImages={stageImages}
      />,
    );

    const textbox = screen.getByRole('textbox', { name: 'Message Codex' });
    fireEvent.paste(textbox, clipboardWithImage(imageFile('a.png')));
    fireEvent.paste(textbox, clipboardWithImage(imageFile('b.png')));
    await screen.findByRole('img', { name: 'a.png' });
    await user.type(textbox, 'go');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    // The first paste is issued; the second waits for it to settle.
    await waitFor(() => expect(onSendInput).toHaveBeenCalledTimes(1));
    expect(onSendInput).toHaveBeenCalledWith('w1:p1', {
      text: '\x1b[200~/tmp/chat-1.png\x1b[201~',
    });
    gate.resolve();
    await waitFor(() => expect(onSendInput).toHaveBeenCalledTimes(2));
    expect(onSendInput).toHaveBeenCalledWith('w1:p1', {
      text: '\x1b[200~/tmp/chat-2.png\x1b[201~',
    });
    await waitFor(() =>
      expect(onPrompt).toHaveBeenCalledWith('w1:p1', '[Image #1]\n[Image #2]\n\ngo'),
    );
  });

  it('keeps attachments when the prompt send fails after staging', async () => {
    const user = userEvent.setup();
    const onPrompt = vi.fn(async () => {
      throw new Error('engine busy');
    });
    const onSendInput = vi.fn(async () => undefined);
    const stageImages = vi.fn(async () => ['/tmp/staged.png']);
    render(
      <ChatPanel
        onPrompt={onPrompt}
        onSendInput={onSendInput}
        pane={pane}
        readOutput={readOutputStub()}
        stageImages={stageImages}
      />,
    );

    const textbox = screen.getByRole('textbox', { name: 'Message Codex' });
    fireEvent.paste(textbox, clipboardWithImage(imageFile()));
    await screen.findByRole('img', { name: 'paste.png' });
    await user.type(textbox, 'look at this');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText(/could not send this message/i)).toBeInTheDocument();
    expect(stageImages).toHaveBeenCalledOnce();
    expect(onSendInput).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img', { name: 'paste.png' })).toBeInTheDocument();
  });

  it('accepts a drag-over with protected drag data followed by a drop of an image file', async () => {
    render(
      <ChatPanel
        onPrompt={vi.fn()}
        pane={pane}
        readOutput={readOutputStub()}
        stageImages={vi.fn()}
      />,
    );

    const dropZone = screen.getByRole('textbox', { name: 'Message Codex' }).closest('form');
    expect(dropZone).not.toBeNull();
    // During drag-over the drag store is protected: only types are visible.
    fireEvent.dragOver(dropZone as HTMLFormElement, {
      dataTransfer: { types: ['Files'], items: [], files: [] },
    });
    fireEvent.drop(dropZone as HTMLFormElement, {
      dataTransfer: { files: [imageFile('drop.png')] },
    });

    expect(await screen.findByRole('img', { name: 'drop.png' })).toBeInTheDocument();
  });

  it('projects the agent reply for an image-only turn', async () => {
    const user = userEvent.setup();
    const onPrompt = vi.fn(async () => undefined);
    const onSendInput = vi.fn(async () => undefined);
    const readOutput = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'pane-output' as const,
        paneId: 'w1:p1',
        workspaceId: 'w1',
        tabId: 'w1:t1',
        text: 'ready',
        revision: 1,
        truncated: false,
      })
      .mockResolvedValueOnce({
        type: 'pane-output' as const,
        paneId: 'w1:p1',
        workspaceId: 'w1',
        tabId: 'w1:t1',
        text: 'ready\n[image attached]',
        revision: 2,
        truncated: false,
      })
      .mockResolvedValue({
        type: 'pane-output' as const,
        paneId: 'w1:p1',
        workspaceId: 'w1',
        tabId: 'w1:t1',
        text: 'ready\n[image attached]\nThe diagram shows the layout.',
        revision: 3,
        truncated: false,
      });
    render(
      <ChatPanel
        onPrompt={onPrompt}
        onSendInput={onSendInput}
        pane={pane}
        readOutput={readOutput}
        stageImages={vi.fn(async () => ['/tmp/staged.png'])}
      />,
    );

    fireEvent.paste(
      screen.getByRole('textbox', { name: 'Message Codex' }),
      clipboardWithImage(imageFile()),
    );
    await screen.findByRole('img', { name: 'paste.png' });
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText(/The diagram shows the layout/)).toBeInTheDocument();
  });

  it('rejects zero-byte and oversized image files with a notice', async () => {
    render(<ChatPanel onPrompt={vi.fn()} pane={pane} readOutput={readOutputStub()} />);

    const textbox = screen.getByRole('textbox', { name: 'Message Codex' });
    const empty = new File([], 'empty.png', { type: 'image/png' });
    fireEvent.paste(textbox, {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => empty }],
        files: [empty],
      },
    });
    expect(await screen.findByText(/16 MiB/i)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'empty.png' })).not.toBeInTheDocument();

    const oversized = new File([new ArrayBuffer(MAX_CHAT_IMAGE_BYTES + 1)], 'big.png', {
      type: 'image/png',
    });
    fireEvent.paste(textbox, {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => oversized }],
        files: [oversized],
      },
    });
    expect(screen.getByText(/16 MiB/i)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'big.png' })).not.toBeInTheDocument();
  });

  it('revokes staged attachment URLs after a successful send', async () => {
    const user = userEvent.setup();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    render(
      <ChatPanel
        onPrompt={vi.fn(async () => undefined)}
        onSendInput={vi.fn(async () => undefined)}
        pane={pane}
        readOutput={readOutputStub()}
        stageImages={vi.fn(async () => ['/tmp/staged.png'])}
      />,
    );

    const textbox = screen.getByRole('textbox', { name: 'Message Codex' });
    fireEvent.paste(textbox, clipboardWithImage(imageFile()));
    await screen.findByRole('img', { name: 'paste.png' });
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'paste.png' })).not.toBeInTheDocument(),
    );
    expect(revoke).toHaveBeenCalledWith(expect.stringContaining('blob:'));
    revoke.mockRestore();
  });

  it('keeps attachments added while a send is in flight', async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();
    const onSendInput = vi.fn(() => gate.promise);
    render(
      <ChatPanel
        onPrompt={vi.fn(async () => undefined)}
        onSendInput={onSendInput}
        pane={pane}
        readOutput={readOutputStub()}
        stageImages={vi.fn(async () => ['/tmp/staged.png'])}
      />,
    );

    const textbox = screen.getByRole('textbox', { name: 'Message Codex' });
    fireEvent.paste(textbox, clipboardWithImage(imageFile('first.png')));
    await screen.findByRole('img', { name: 'first.png' });
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(onSendInput).toHaveBeenCalled());

    // A second image is dropped while the first send is still pending.
    fireEvent.paste(textbox, clipboardWithImage(imageFile('second.png')));
    await screen.findByRole('img', { name: 'second.png' });
    gate.resolve();

    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'first.png' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('img', { name: 'second.png' })).toBeInTheDocument();
  });

  it('renders an image-only submission with its numbered image reference', async () => {
    const user = userEvent.setup();
    render(
      <ChatPanel
        onPrompt={vi.fn(async () => undefined)}
        onSendInput={vi.fn(async () => undefined)}
        pane={pane}
        readOutput={readOutputStub()}
        stageImages={vi.fn(async () => ['/tmp/staged.png'])}
      />,
    );

    fireEvent.paste(
      screen.getByRole('textbox', { name: 'Message Codex' }),
      clipboardWithImage(imageFile()),
    );
    await screen.findByRole('img', { name: 'paste.png' });
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('[Image #1]')).toBeInTheDocument();
  });

  it('shows a notice when the attachment limit is reached', async () => {
    const user = userEvent.setup();
    render(<ChatPanel onPrompt={vi.fn()} pane={pane} readOutput={readOutputStub()} />);

    const textbox = screen.getByRole('textbox', { name: 'Message Codex' });
    for (let index = 0; index < MAX_CHAT_IMAGE_ATTACHMENTS + 1; index += 1) {
      fireEvent.paste(textbox, clipboardWithImage(imageFile(`img-${index}.png`)));
    }
    await screen.findByRole('img', { name: 'img-0.png' });
    expect(await screen.findByText(/image limit reached/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('img', { name: `img-${MAX_CHAT_IMAGE_ATTACHMENTS}.png` }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove img-0.png' }));
    await waitFor(() => expect(screen.queryByText(/image limit reached/i)).not.toBeInTheDocument());
  });
});

describe('ChatPanel thinking color at completion', () => {
  it('keeps thinking gray and turns only the final response white when the turn completes', async () => {
    const user = userEvent.setup();
    const gray = '\x1b[38;2;128;128;128m';
    const reset = '\x1b[0m';
    const readyOutput = {
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: 'ready',
      revision: 1,
      truncated: false,
    };
    const workingOutput = {
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: `ready\nFix the layout\n${gray}The user wants the layout fixed.${reset}\n- Here is the fix.`,
      revision: 3,
      truncated: false,
    };
    const completedOutput = {
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      // The final frame collapsed the current thinking block, lost its
      // markers, but still carries muted output from an older turn.
      text: `${gray}Older turn note.${reset}\nready\nFix the layout\n- Here is the fix.`,
      revision: 4,
      truncated: false,
    };
    let phase: 'ready' | 'working' | 'completed' = 'ready';
    let releaseWorking!: () => void;
    let releaseCompleted!: () => void;
    const workingGate = new Promise<void>((resolve) => {
      releaseWorking = resolve;
    });
    const completedGate = new Promise<void>((resolve) => {
      releaseCompleted = resolve;
    });
    const readOutput = vi.fn(async () => {
      if (phase === 'ready') {
        return readyOutput;
      }
      if (phase === 'working') {
        await workingGate;
        return workingOutput;
      }
      await completedGate;
      return completedOutput;
    });
    const { rerender } = render(
      <ChatPanel onPrompt={vi.fn(async () => undefined)} pane={pane} readOutput={readOutput} />,
    );
    await screen.findByText('ready');

    await user.type(screen.getByRole('textbox', { name: 'Message Codex' }), 'Fix the layout');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    // While working, the pane streams the thinking block with its gray markers.
    phase = 'working';
    rerender(
      <ChatPanel
        onPrompt={vi.fn(async () => undefined)}
        pane={{ ...pane, revision: 3 }}
        readOutput={readOutput}
      />,
    );
    await act(async () => {
      releaseWorking();
    });
    await screen.findByText(/The user wants the layout fixed/);
    // The turn completes: the final frame collapses the thinking block.
    phase = 'completed';
    rerender(
      <ChatPanel
        onPrompt={vi.fn(async () => undefined)}
        pane={{ ...pane, agent_status: 'idle', revision: 4 }}
        readOutput={readOutput}
      />,
    );
    await act(async () => {
      releaseCompleted();
    });

    const thinking = await screen.findByText(/The user wants the layout fixed/);
    expect(thinking.closest('p')).toHaveClass('text-thinking-foreground');
    const answer = screen.getByText(/- Here is the fix/);
    expect(answer.closest('p')).toHaveClass('text-response-foreground');
  });
  it('keeps preformatted thinking blocks gray when the turn completes', async () => {
    const user = userEvent.setup();
    const gray = '\x1b[38;2;128;128;128m';
    const reset = '\x1b[0m';
    const table = '┌──────┐\n│ plan │\n└──────┘';
    const readyOutput = {
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: 'ready',
      revision: 1,
      truncated: false,
    };
    const workingOutput = {
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      text: `ready\nFix the layout\n${gray}┌──────┐${reset}\n${gray}│ plan │${reset}\n${gray}└──────┘${reset}\n\n- Here is the fix.`,
      revision: 3,
      truncated: false,
    };
    const completedOutput = {
      type: 'pane-output' as const,
      paneId: 'w1:p1',
      workspaceId: 'w1',
      tabId: 'w1:t1',
      // The final frame dropped the thinking markers but kept the table.
      text: `ready\nFix the layout\n${table}\n\n- Here is the fix.`,
      revision: 4,
      truncated: false,
    };
    let phase: 'ready' | 'working' | 'completed' = 'ready';
    let releaseWorking!: () => void;
    let releaseCompleted!: () => void;
    const workingGate = new Promise<void>((resolve) => {
      releaseWorking = resolve;
    });
    const completedGate = new Promise<void>((resolve) => {
      releaseCompleted = resolve;
    });
    const readOutput = vi.fn(async () => {
      if (phase === 'ready') {
        return readyOutput;
      }
      if (phase === 'working') {
        await workingGate;
        return workingOutput;
      }
      await completedGate;
      return completedOutput;
    });
    const { rerender } = render(
      <ChatPanel onPrompt={vi.fn(async () => undefined)} pane={pane} readOutput={readOutput} />,
    );
    await screen.findByText('ready');

    await user.type(screen.getByRole('textbox', { name: 'Message Codex' }), 'Fix the layout');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    phase = 'working';
    rerender(
      <ChatPanel
        onPrompt={vi.fn(async () => undefined)}
        pane={{ ...pane, revision: 3 }}
        readOutput={readOutput}
      />,
    );
    await act(async () => {
      releaseWorking();
    });
    await screen.findByText(/│ plan │/);

    phase = 'completed';
    rerender(
      <ChatPanel
        onPrompt={vi.fn(async () => undefined)}
        pane={{ ...pane, agent_status: 'idle', revision: 4 }}
        readOutput={readOutput}
      />,
    );
    await act(async () => {
      releaseCompleted();
    });

    // The completed turn's thinking table stays gray; only the answer turns
    // white.
    const tableBlock = await screen.findByText(/┌──────┐\s+│ plan │\s+└──────┘/);
    expect(tableBlock.tagName).toBe('PRE');
    expect(tableBlock).toHaveClass('text-thinking-foreground');
    const answer = screen.getByText(/- Here is the fix/);
    expect(answer.closest('p')).toHaveClass('text-response-foreground');
  });

  describe('slash command menu', () => {
    const renderChat = (onSendInput = vi.fn(async () => undefined)) => {
      const readOutput = vi.fn(async () => ({
        type: 'pane-output' as const,
        paneId: 'w1:p1',
        workspaceId: 'w1',
        tabId: 'w1:t1',
        text: 'ready',
        revision: 1,
        truncated: false,
      }));
      render(
        <ChatPanel
          onPrompt={vi.fn(async () => undefined)}
          onSendInput={onSendInput}
          pane={pane}
          readOutput={readOutput}
        />,
      );
      return { onSendInput };
    };
    const textbox = () =>
      screen.getByRole('textbox', { name: 'Message Codex' }) as HTMLTextAreaElement;
    const options = () => screen.queryAllByRole('option');

    it('opens a command list when the draft starts with a slash', async () => {
      const user = userEvent.setup();
      renderChat();

      await user.type(textbox(), '/');
      const listbox = await screen.findByRole('listbox', { name: 'Slash commands' });
      expect(listbox).toBeInTheDocument();
      expect(options().length).toBeGreaterThan(8);
      expect(screen.getByRole('option', { name: /^\/clear\b/ })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /^\/compact\b/ })).toBeInTheDocument();
    });

    it('exposes the open menu and active option to assistive technology', async () => {
      const user = userEvent.setup();
      renderChat();

      await user.type(textbox(), '/');
      const listbox = await screen.findByRole('listbox', { name: 'Slash commands' });
      const selected = options().find((option) => option.getAttribute('aria-selected') === 'true');

      expect(listbox.id).not.toBe('');
      expect(selected?.id).not.toBe('');
      expect(textbox()).toHaveAttribute('aria-controls', listbox.id);
      expect(textbox()).toHaveAttribute('aria-expanded', 'true');
      expect(textbox()).toHaveAttribute('aria-activedescendant', selected?.id);

      await user.keyboard('{Escape}');
      expect(textbox()).toHaveAttribute('aria-expanded', 'false');
      expect(textbox()).not.toHaveAttribute('aria-activedescendant');
    });

    it('filters commands as the user types after the slash', async () => {
      const user = userEvent.setup();
      renderChat();

      await user.type(textbox(), '/co');
      const names = options().map((option) => option.textContent ?? '');
      expect(names.some((name) => name.includes('/compact'))).toBe(true);
      expect(names.some((name) => name.includes('/copy'))).toBe(true);
      expect(names.some((name) => name.includes('/model'))).toBe(false);
    });

    it('navigates with arrow keys and fills the draft on Enter', async () => {
      const user = userEvent.setup();
      const { onSendInput } = renderChat();

      await user.type(textbox(), '/');
      await screen.findByRole('listbox');
      await user.keyboard('{ArrowDown}');
      const selected = options().find((option) => option.getAttribute('aria-selected') === 'true');
      expect(selected?.textContent).toContain('/new');
      await user.keyboard('{Enter}');

      expect(textbox().value).toBe('/new');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(onSendInput).not.toHaveBeenCalled();
    });

    it('keeps the keyboard-selected command visible while navigating a long list', async () => {
      const user = userEvent.setup();
      renderChat();

      await user.type(textbox(), '/');
      await screen.findByRole('listbox');
      const target = options()[12];
      const scrollIntoView = vi.fn();
      target.scrollIntoView = scrollIntoView;

      for (let index = 0; index < 12; index += 1) {
        await user.keyboard('{ArrowDown}');
      }

      expect(target).toHaveAttribute('aria-selected', 'true');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    });

    it('leaves a trailing space when the command takes an argument', async () => {
      const user = userEvent.setup();
      renderChat();

      await user.type(textbox(), '/mo');
      await screen.findByRole('listbox');
      await user.keyboard('{Enter}');

      expect(textbox().value).toBe('/model ');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('closes on Escape and reopens when the draft changes', async () => {
      const user = userEvent.setup();
      renderChat();

      await user.type(textbox(), '/');
      await screen.findByRole('listbox');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

      await user.keyboard('c');
      expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    });

    it('does not select a command while the user is composing text', async () => {
      const user = userEvent.setup();
      const { onSendInput } = renderChat();

      await user.type(textbox(), '/');
      await screen.findByRole('listbox');
      fireEvent.keyDown(textbox(), { key: 'Enter', isComposing: true });

      expect(textbox().value).toBe('/');
      expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
      expect(onSendInput).not.toHaveBeenCalled();
    });

    it('selects a command by clicking and keeps focus in the composer', async () => {
      const user = userEvent.setup();
      renderChat();

      await user.type(textbox(), '/');
      await screen.findByRole('listbox');
      await user.click(screen.getByRole('option', { name: /^\/compact\b/ }));

      expect(textbox().value).toBe('/compact');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(textbox()).toHaveFocus();
    });

    it('closes when the user types an argument and sends the raw command on Enter', async () => {
      const user = userEvent.setup();
      const { onSendInput } = renderChat();

      await user.type(textbox(), '/model gpt-5.6');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      await user.keyboard('{Enter}');

      expect(onSendInput).toHaveBeenCalledWith('w1:p1', {
        text: '/model gpt-5.6',
        keys: ['enter'],
      });
    });
  });
});
