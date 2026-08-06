import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserPreviewApi } from '@/renderer/browser-preview';

describe('createBrowserPreviewApi', () => {
  afterEach(() => vi.useRealTimers());

  it('simulates a complete prompt and live output cycle through the typed desktop API', async () => {
    vi.useFakeTimers();
    const api = createBrowserPreviewApi();
    const events: string[] = [];
    api.onSessionEvent((event) => events.push(event.event));

    const before = await api.query({ type: 'read-pane-output', paneId: 'w1:p1' });
    expect(before).toMatchObject({ type: 'pane-output', revision: 42 });

    const working = await api.command({
      type: 'prompt-agent',
      target: 'w1:p1',
      text: 'Align the composer',
    });
    expect(working.state).toBe('connected');
    if (working.state === 'connected') {
      expect(working.snapshot.panes.find((pane) => pane.pane_id === 'w1:p1')).toMatchObject({
        agent_status: 'working',
        revision: 43,
      });
    }
    await expect(api.query({ type: 'read-pane-output', paneId: 'w1:p1' })).resolves.toMatchObject({
      text: expect.stringContaining('Align the composer'),
      revision: 43,
    });

    await vi.advanceTimersByTimeAsync(900);
    expect(events).toContain('pane.output_changed');
    const settled = await api.bootstrap();
    if (settled.state === 'connected') {
      expect(settled.snapshot.panes.find((pane) => pane.pane_id === 'w1:p1')).toMatchObject({
        agent_status: 'done',
        revision: 44,
      });
    }
  });
});
