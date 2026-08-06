import type { HerdrDesktopApi } from '@/shared/desktop-api';

declare global {
  interface Window {
    herdr: HerdrDesktopApi;
  }
}
