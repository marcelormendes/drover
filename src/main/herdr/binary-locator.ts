import path from 'node:path';

/**
 * Candidate install locations for the herdr engine, checked when the binary
 * is not on the PATH. The official install script puts herdr in
 * ~/.local/bin; Homebrew and Intel macs use the other two.
 */
const FALLBACK_CANDIDATES = (home: string): readonly string[] => [
  path.join(home, '.local', 'bin', 'herdr'),
  path.join('/opt/homebrew', 'bin', 'herdr'),
  path.join('/usr/local', 'bin', 'herdr'),
];

export interface ResolveHerdrBinaryOptions {
  /** HERDR_DESKTOP_BIN override. */
  envBinary?: string;
  /** os.homedir(); used for the ~/.local/bin candidate. */
  home?: string;
  /** process.env.PATH split on ':'. */
  pathEntries?: readonly string[];
  /** Executability probe (e.g. fs.accessSync with X_OK). */
  canExecute: (file: string) => boolean;
  /**
   * Inside the Herdr Desktop Flatpak: the sandbox cannot probe host paths,
   * and the process bridge resolves commands on the host with a deterministic
   * PATH. Skip sandbox executability checks; `envBinary` is accepted as a host
   * path as-is, and a bare `herdr` resolves on the host PATH.
   */
  flatpakHost?: boolean;
}

/**
 * Resolves the herdr engine binary the way a GUI-launched app can: Finder
 * apps get a minimal PATH, so `herdr` may not resolve even when it is
 * installed. Returns the env override, a bare `herdr` when it is on the
 * PATH, or the first executable fallback location; null when nothing is
 * found. In Flatpak mode the host-side bridge performs the lookup instead.
 */
export function resolveHerdrBinary({
  envBinary,
  home = '',
  pathEntries = [],
  canExecute,
  flatpakHost = false,
}: ResolveHerdrBinaryOptions): string | null {
  if (flatpakHost) {
    const normalized = envBinary?.trim();
    return normalized ? normalized : 'herdr';
  }
  if (envBinary && canExecute(envBinary)) {
    return envBinary;
  }
  for (const entry of pathEntries) {
    if (entry && canExecute(path.join(entry, 'herdr'))) {
      return 'herdr';
    }
  }
  if (home) {
    for (const candidate of FALLBACK_CANDIDATES(home)) {
      if (canExecute(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}
