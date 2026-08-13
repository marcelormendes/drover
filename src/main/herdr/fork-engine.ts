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
  version: '0.8.4',
  repository: 'marcelormendes/herdr',
  assets: {
    'linux-x64': {
      url: 'https://github.com/marcelormendes/herdr/releases/download/v0.8.4/herdr-linux-x86_64',
      sha256: 'f6a36790f71636e67cb3c4e232adcd6137aad27254d8b34898a5a32c12a7eeae',
    },
    'linux-arm64': {
      url: 'https://github.com/marcelormendes/herdr/releases/download/v0.8.4/herdr-linux-aarch64',
      sha256: '80185301e1ec1bd4763479cdd717d221f507e69798a00f4092a273b3e8aa1597',
    },
    'darwin-x64': {
      url: 'https://github.com/marcelormendes/herdr/releases/download/v0.8.4/herdr-macos-x86_64',
      sha256: '6239ccf210fa9c7b3c1875c1a67a292de7830f574d5d74e69f46f8f00aed5b64',
    },
    'darwin-arm64': {
      url: 'https://github.com/marcelormendes/herdr/releases/download/v0.8.4/herdr-macos-aarch64',
      sha256: 'e9b3d087fea18ce6c34b87170459f53dc79f1a2aa953d2de0670be3f8b54903d',
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
