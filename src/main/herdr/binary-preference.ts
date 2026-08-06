import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface BinaryPreferenceFile {
  herdrBinary: string;
}

export class HerdrBinaryPreference {
  constructor(private readonly filePath: string) {}

  async read(): Promise<string | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (
        typeof value === 'object' &&
        value !== null &&
        'herdrBinary' in value &&
        typeof value.herdrBinary === 'string' &&
        value.herdrBinary.length > 0
      ) {
        return value.herdrBinary;
      }
    } catch {
      return null;
    }
    return null;
  }

  async write(herdrBinary: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const value: BinaryPreferenceFile = { herdrBinary };
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
