/**
 * Declarations for scripts/build-flatpak.mjs, imported by the release-wiring
 * regression tests to pin the packaging contract without executing a build.
 */
export const FLATPAK_APP_ID: string;
export const FLATPAK_BRANCH: string;
export const FLATPAK_RUNTIME_VERSION: string;
export const FLATPAK_ARCH: string;
export const FLATPAK_BUNDLE_NAME: string;

export interface FlatpakManifestSource {
  type: 'dir' | 'file';
  path: string;
  /** Optional flatpak-builder source rename; the dir source uses it so the
   * app lands in a `flatpak-app` subdirectory of the module build root. */
  dest?: string;
}

export interface FlatpakStagedSource extends FlatpakManifestSource {
  resolved: string;
}

export function flatpakManifestSources(manifestPath: string): FlatpakManifestSource[];
export function flatpakStagedSourcePaths(
  stagedDir: string,
  manifestPath?: string,
): FlatpakStagedSource[];
export function probeTool(program: string, options?: { env?: NodeJS.ProcessEnv }): boolean;
