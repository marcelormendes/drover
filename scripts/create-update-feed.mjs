import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createUpdateFeed(directory, version, arch) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !['arm64', 'x64'].includes(arch)) {
    throw new Error('Expected a stable release version and a macOS architecture.');
  }
  const asset = `drover-macos-${arch}.zip`;
  const archive = path.join(directory, asset);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const feed = {
    currentRelease: version,
    releases: [
      {
        version,
        updateTo: {
          version,
          name: `Drover ${version}`,
          url: `https://github.com/marcelormendes/drover/releases/download/v${version}/${asset}`,
          sha256: hash.digest('hex'),
          size: (await stat(archive)).size,
        },
      },
    ],
  };
  await writeFile(
    path.join(directory, `drover-macos-${arch}.json`),
    `${JSON.stringify(feed, null, 2)}\n`,
  );
  return feed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createUpdateFeed(...process.argv.slice(2));
}
