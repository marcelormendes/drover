export interface SystemNotificationRequest {
  title: string;
  body: string;
  sound: boolean;
  onOpen: () => void;
}

interface NativeNotificationHandle {
  setOnClick(listener: () => void): void;
  close(): void;
}

export interface NativeNotificationApi {
  permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  create(title: string, options: NotificationOptions): NativeNotificationHandle;
}

function browserNotificationApi(): NativeNotificationApi | undefined {
  if (typeof Notification === 'undefined') {
    return undefined;
  }
  return {
    permission: Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    create: (title, options) => {
      const notification = new Notification(title, options);
      return {
        close: () => notification.close(),
        setOnClick: (listener) => {
          notification.onclick = listener;
        },
      };
    },
  };
}

export async function deliverSystemNotification(
  request: SystemNotificationRequest,
  api = browserNotificationApi(),
): Promise<boolean> {
  if (!api || api.permission === 'denied') {
    return false;
  }
  const permission = api.permission === 'granted' ? api.permission : await api.requestPermission();
  if (permission !== 'granted') {
    return false;
  }
  const notification = api.create(request.title, {
    body: request.body,
    silent: !request.sound,
  });
  notification.setOnClick(() => {
    request.onOpen();
    notification.close();
  });
  return true;
}
