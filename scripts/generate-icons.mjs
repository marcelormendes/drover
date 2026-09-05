import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'darwin') {
  throw new Error('Icon generation requires macOS sips and iconutil.');
}

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'resources', 'icon-1024.png');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'drover-icons-'));
const iconset = path.join(temporary, 'Drover.iconset');
const resize = (size, output) => {
  execFileSync('sips', ['-z', String(size), String(size), source, '--out', output], {
    stdio: 'ignore',
  });
};

try {
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    resize(size, path.join(iconset, `icon_${size}x${size}.png`));
    resize(size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  execFileSync('iconutil', [
    '--convert',
    'icns',
    '--output',
    path.join(root, 'resources', 'icon.icns'),
    iconset,
  ]);
  resize(512, path.join(root, 'flatpak', 'icon-512.png'));
  console.log('Generated macOS and Flatpak icons from resources/icon-1024.png.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
