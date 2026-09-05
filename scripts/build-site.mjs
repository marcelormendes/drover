import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'dist', 'site');

await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'site'), output, { recursive: true });
await copyFile(path.join(root, 'resources', 'icon-1024.png'), path.join(output, 'icon.png'));
const iconHash = createHash('sha256')
  .update(await readFile(path.join(output, 'icon.png')))
  .digest('hex')
  .slice(0, 12);
const indexPath = path.join(output, 'index.html');
await writeFile(
  indexPath,
  (await readFile(indexPath, 'utf8')).replaceAll('__ICON_HASH__', iconHash),
);
await copyFile(path.join(root, 'scripts', 'install.sh'), path.join(output, 'install.sh'));
await writeFile(path.join(output, '.nojekyll'), '');

console.log(`Built static site in ${output}`);
