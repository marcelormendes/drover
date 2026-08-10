import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerAppImage } from '@reforged/maker-appimage';
import { APP_DESCRIPTION, APP_NAME } from './src/main/app-branding';

const applePlatforms = new Set(['darwin', 'mas']);
const execFileAsync = promisify(execFile);
const macosSignIdentity = process.env.HERDR_MACOS_SIGN_IDENTITY?.trim();
const macosNotarize = ['1', 'true', 'yes'].includes(
  process.env.HERDR_MACOS_NOTARIZE?.toLowerCase() ?? '',
);

function notarizationCredentials() {
  if (!macosNotarize) {
    return undefined;
  }
  const appleId = process.env.APPLE_ID?.trim();
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim();
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  if (!macosSignIdentity || !appleId || !appleIdPassword || !teamId) {
    throw new Error(
      'macOS notarization requires HERDR_MACOS_SIGN_IDENTITY, APPLE_ID, APPLE_TEAM_ID, and APPLE_APP_SPECIFIC_PASSWORD.',
    );
  }
  return { appleId, appleIdPassword, teamId };
}

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: 'dev.herdr.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    appCopyright: 'Copyright © 2026 Herdr Desktop contributors',
    asar: true,
    extendInfo: {
      CFBundleDisplayName: APP_NAME,
      CFBundleGetInfoString: APP_DESCRIPTION,
      CFBundleName: APP_NAME,
    },
    icon: 'resources/icon',
    name: APP_NAME,
    executableName: APP_NAME,
    ...(macosSignIdentity ? { osxSign: { identity: macosSignIdentity } } : {}),
    ...(macosNotarize ? { osxNotarize: notarizationCredentials() } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({
      format: 'ULFO',
      overwrite: true,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerSquirrel({}),
    new MakerRpm({ options: { bin: APP_NAME } }),
    new MakerDeb({ options: { bin: APP_NAME } }),
    new MakerAppImage({
      options: {
        bin: APP_NAME,
        icon: 'resources/icon.svg',
        categories: ['Development', 'Utility'],
        // Vendored type-2 runtime (AppImage/type2-runtime, sha256
        // 1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf) so
        // builds embed a pinned runtime instead of the mutable `continuous`
        // release. License notice: resources/appimage-runtime-x86_64.LICENSE.
        runtime: 'resources/appimage-runtime-x86_64',
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
  ],
  hooks: {
    packageAfterCopy: async (forgeConfig, buildPath, _electronVersion, platform, arch) => {
      const isApplePlatform = applePlatforms.has(platform);
      const executableName = isApplePlatform
        ? 'Electron'
        : `electron${platform === 'win32' ? '.exe' : ''}`;
      const executablePath = isApplePlatform
        ? path.resolve(buildPath, '../..', 'MacOS', executableName)
        : path.resolve(buildPath, '../..', executableName);

      await flipFuses(executablePath, {
        version: FuseVersion.V1,
        strictlyRequireAllFuses: true,
        resetAdHocDarwinSignature:
          isApplePlatform && arch === 'arm64' && !forgeConfig.packagerConfig.osxSign,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
        [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
        [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
        [FuseV1Options.WasmTrapHandlers]: true,
      });
    },
    postPackage: async (forgeConfig, { outputPaths, platform }) => {
      if (!applePlatforms.has(platform)) {
        return;
      }
      for (const outputPath of outputPaths) {
        const appPath = path.join(outputPath, `${APP_NAME}.app`);
        if (forgeConfig.packagerConfig.osxSign) {
          await execFileAsync('/usr/bin/codesign', [
            '--verify',
            '--deep',
            '--strict',
            '--verbose=2',
            appPath,
          ]);
          continue;
        }
        await execFileAsync('/usr/bin/xattr', ['-cr', appPath]);
        await execFileAsync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath]);
      }
    },
  },
};

export default config;
