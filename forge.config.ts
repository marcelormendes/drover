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

const applePlatforms = new Set(['darwin', 'mas']);
const execFileAsync = promisify(execFile);

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: 'dev.herdr.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    asar: true,
    icon: 'resources/icon',
    name: 'Herdr Desktop',
    executableName: 'Herdr Desktop',
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({
      format: 'ULFO',
      overwrite: true,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerSquirrel({}),
    new MakerRpm({}),
    new MakerDeb({}),
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
    postPackage: async (_forgeConfig, { outputPaths, platform }) => {
      if (!applePlatforms.has(platform)) {
        return;
      }
      for (const outputPath of outputPaths) {
        const appPath = path.join(outputPath, 'Herdr Desktop.app');
        await execFileAsync('/usr/bin/xattr', ['-cr', appPath]);
        await execFileAsync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath]);
      }
    },
  },
};

export default config;
