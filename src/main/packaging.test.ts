import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { APP_DESCRIPTION, APP_NAME } from '@/main/app-branding';
import forgeConfig from '../../forge.config';

describe('desktop package metadata', () => {
  it('uses the product name and description in npm and the macOS bundle', async () => {
    const packageInfo = JSON.parse(await readFile('package.json', 'utf8')) as {
      description: string;
      productName: string;
    };

    expect(packageInfo.productName).toBe(APP_NAME);
    expect(packageInfo.description).toBe(APP_DESCRIPTION);
    expect(forgeConfig.packagerConfig).toMatchObject({
      appCopyright: 'Copyright © 2026 Drover contributors',
      executableName: APP_NAME,
      extendInfo: {
        CFBundleDisplayName: APP_NAME,
        CFBundleGetInfoString: APP_DESCRIPTION,
        CFBundleName: APP_NAME,
      },
      name: APP_NAME,
    });
  });
});
