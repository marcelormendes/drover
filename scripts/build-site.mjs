import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'dist', 'site');

await rm(output, { force: true, recursive: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'site'), output, { recursive: true });
await copyFile(path.join(root, 'resources', 'icon-1024.png'), path.join(output, 'icon.png'));
await copyFile(path.join(root, 'scripts', 'install.sh'), path.join(output, 'install.sh'));
await writeFile(path.join(output, '.nojekyll'), '');

console.log(`Built static site in ${output}`);
