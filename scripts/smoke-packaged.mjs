import { spawn } from 'node:child_process';
import path from 'node:path';

const productName = 'Drover';
const executableName = 'Drover';
const targetDirectory =
  process.env.DROVER_PACKAGE_DIR ??
  path.resolve('out', `${productName}-${process.platform}-${process.arch}`);
const binaryPath =
  process.platform === 'darwin'
    ? path.join(targetDirectory, `${productName}.app`, 'Contents', 'MacOS', executableName)
    : path.join(targetDirectory, `${executableName}${process.platform === 'win32' ? '.exe' : ''}`);

const child = spawn(binaryPath, [], {
  env: { ...process.env, DROVER_SMOKE_TEST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';

child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

const outcome = await Promise.race([
  new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ kind: 'exit', code, signal }));
    child.once('error', (error) => resolve({ kind: 'error', error }));
  }),
  new Promise((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 10_000)),
]);

if (outcome.kind === 'timeout') {
  child.kill('SIGTERM');
  throw new Error(`Packaged app did not report a loaded renderer in time.\n${output}`);
}

if (outcome.kind !== 'exit' || outcome.code !== 0) {
  throw new Error(
    `Packaged app failed its renderer smoke test: ${JSON.stringify(outcome)}\n${output}`,
  );
}

console.log(`Packaged renderer loaded successfully: ${binaryPath}`);
