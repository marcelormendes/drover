import type { DroverApi } from '@/shared/desktop-api';

declare global {
  interface Window {
    herdr: DroverApi;
  }
}
