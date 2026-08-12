import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import forgeCore from '@electron-forge/core';

const command = process.argv[2];

if (command !== 'make' && command !== 'test-package') {
  throw new Error('Usage: node scripts/forge-in-temp.mjs <make|test-package>');
}

const projectDirectory = process.cwd();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'drover-forge-'));
const temporaryOut = path.join(temporaryRoot, 'out');
const requestedArch = process.env.DROVER_ARCH;
if (requestedArch && requestedArch !== 'arm64' && requestedArch !== 'x64') {
  throw new Error('DROVER_ARCH must be arm64 or x64.');
}
const targetArch = requestedArch || process.arch;
function run(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: projectDirectory,
      env: process.env,
      stdio: 'inherit',
      ...options,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${program} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

try {
  const options = {
    arch: targetArch,
    dir: projectDirectory,
    interactive: false,
    outDir: temporaryOut,
  };
  if (command === 'make') {
    await forgeCore.api.make(options);
  } else {
    await forgeCore.api.package(options);
  }

  if (command === 'test-package') {
    const packageDirectory = path.join(temporaryOut, `Drover-${process.platform}-${targetArch}`);
    await run(process.execPath, [path.join(projectDirectory, 'scripts', 'smoke-packaged.mjs')], {
      env: { ...process.env, DROVER_PACKAGE_DIR: packageDirectory },
    });
  } else {
    const source = path.join(temporaryOut, 'make');
    const destination = path.join(projectDirectory, 'out', 'make');
    await rm(destination, { force: true, recursive: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
    console.log(`Release artifacts copied to ${destination}`);
  }
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
