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
}

/**
 * Resolves the herdr engine binary the way a GUI-launched app can: Finder
 * apps get a minimal PATH, so `herdr` may not resolve even when it is
 * installed. Returns the env override, a bare `herdr` when it is on the
 * PATH, or the first executable fallback location; null when nothing is
 * found.
 */
export function resolveHerdrBinary({
  envBinary,
  home = '',
  pathEntries = [],
  canExecute,
}: ResolveHerdrBinaryOptions): string | null {
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
