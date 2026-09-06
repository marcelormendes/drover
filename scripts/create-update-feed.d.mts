export function createUpdateFeed(
  directory: string,
  version: string,
  arch: string,
): Promise<{
  currentRelease: string;
  releases: Array<{
    version: string;
    updateTo: { version: string; name: string; url: string; sha256: string; size: number };
  }>;
}>;
