import { createHash } from 'node:crypto';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The pinned Herdr engine build that provides structured Chat (the
 * `agent_conversations` server capability). It is distributed from the fork
 * release artifacts because `herdr update` always downloads the stock
 * upstream binary, which lacks the capability.
 *
 * The Desktop installs this exact build itself: download, verify the SHA-256
 * checksum, replace the resolved engine binary, and live-hand the running
 * server onto it. Keep `sha256` values in sync with the published release
 * assets for `version`; an empty checksum means the release is not published
 * yet and the install is refused.
 */
export const PINNED_ENGINE = {
  version: '0.8.8',
  repository: 'marcelormendes/herdr',
  assets: {
    'linux-x64': {
      url: 'https://github.com/marcelormendes/herdr/releases/download/v0.8.8/herdr-linux-x86_64',
      sha256: 'bc58681c9c443c980d77ab3809fa87654433bf5087d8ffe2ec5bb984615b2e83',
    },
    'linux-arm64': {
      url: 'https://github.com/marcelormendes/herdr/releases/download/v0.8.8/herdr-linux-aarch64',
      sha256: '9b7a2a171d36fd3a2c3f3d2dfdde0fb2fe52fe84395474605ca19e2b34e3fff3',
    },
    'darwin-x64': {
      url: 'https://github.com/marcelormendes/herdr/releases/download/v0.8.8/herdr-macos-x86_64',
      sha256: '1896ac30c22cb9983a9dec530cb9494139098b765a1a8253f978dd63c88c1091',
    },
    'darwin-arm64': {
      url: 'https://github.com/marcelormendes/herdr/releases/download/v0.8.8/herdr-macos-aarch64',
      sha256: '2627119abbe3e6aeef63934ee0d748676c3d4aa5a5881c6b4ead86cf47344b41',
    },
  },
} as const;

export interface PinnedEngineAsset {
  readonly url: string;
  readonly sha256: string;
}

type PinnedAssetKey = keyof typeof PINNED_ENGINE.assets;

/** The pinned asset for the running platform, or null when unsupported. */
export function pinnedEngineAsset(
  platform: NodeJS.Platform,
  arch: string,
): PinnedEngineAsset | null {
  return (PINNED_ENGINE.assets as Record<string, PinnedEngineAsset>)[`${platform}-${arch}`] ?? null;
}

/** True when the platform has a pinned asset entry, even if unpublished. */
export function hasPinnedEngineRelease(platform: NodeJS.Platform, arch: string): boolean {
  return `${platform}-${arch}` in PINNED_ENGINE.assets;
}

export type BinaryFetcher = (url: string) => Promise<Buffer>;

export async function fetchPinnedEngineBinary(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`failed to download the pinned engine (HTTP ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export function sha256Of(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * The path a freshly installed engine lands on, mirroring the official
 * installer location that the binary locator checks as a fallback.
 */
export function defaultEngineInstallPath(): string {
  return join(homedir(), '.local', 'bin', 'herdr');
}

/**
 * Downloads the pinned engine, verifies its checksum, and atomically
 * replaces `installTo`. The previous inode stays alive for any running
 * server process, so replacing an in-use binary is safe on POSIX.
 */
export async function installPinnedEngineBinary(options: {
  asset: PinnedEngineAsset;
  installTo: string;
  fetchBinary?: BinaryFetcher;
}): Promise<void> {
  const { asset, installTo } = options;
  const fetchBinary = options.fetchBinary ?? fetchPinnedEngineBinary;

  if (asset.sha256.length === 0) {
    throw new Error(
      `The pinned engine release v${PINNED_ENGINE.version} is not published yet; update Drover to install it.`,
    );
  }

  const data = await fetchBinary(asset.url);
  const digest = sha256Of(data);
  if (digest !== asset.sha256) {
    throw new Error(
      `Pinned engine checksum mismatch: expected ${asset.sha256}, got ${digest}. Refusing to install.`,
    );
  }

  const stagingPath = join(dirname(installTo), `.herdr-pinned-${process.pid}-${Date.now()}.tmp`);
  await mkdir(dirname(installTo), { recursive: true });
  await writeFile(stagingPath, data);
  await chmod(stagingPath, 0o755);
  await rename(stagingPath, installTo);
}

export type { PinnedAssetKey };
