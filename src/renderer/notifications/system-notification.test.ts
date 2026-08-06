import { describe, expect, it, vi } from 'vitest';

import { deliverSystemNotification } from '@/renderer/notifications/system-notification';

describe('deliverSystemNotification', () => {
  it('uses the native notification API and routes click-to-focus', async () => {
    const onOpen = vi.fn();
    const close = vi.fn();
    let click: (() => void) | undefined;
    const create = vi.fn((_title: string, _options: NotificationOptions) => ({
      close,
      setOnClick(listener: () => void) {
        click = listener;
      },
    }));

    expect(
      await deliverSystemNotification(
        { title: 'reviewer is blocked', body: 'Open the pane', sound: false, onOpen },
        {
          permission: 'granted',
          requestPermission: vi.fn(async (): Promise<NotificationPermission> => 'granted'),
          create,
        },
      ),
    ).toBe(true);
    expect(create).toHaveBeenCalledWith('reviewer is blocked', {
      body: 'Open the pane',
      silent: true,
    });

    expect(click).toBeTypeOf('function');
    (click as () => void)();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not create a notification after permission is denied', async () => {
    const create = vi.fn();
    expect(
      await deliverSystemNotification(
        { title: 'Done', body: 'Agent completed', sound: true, onOpen: vi.fn() },
        {
          permission: 'default',
          requestPermission: vi.fn(async (): Promise<NotificationPermission> => 'denied'),
          create,
        },
      ),
    ).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
