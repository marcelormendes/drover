import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_DESKTOP_PREFERENCES,
  type DesktopPreferences,
  type DesktopPreferencesInput,
  parseDesktopPreferences,
} from '@/shared/preferences';

export { DEFAULT_DESKTOP_PREFERENCES } from '@/shared/preferences';

export class DesktopPreferencesStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<DesktopPreferences> {
    try {
      const parsed = parseDesktopPreferences(JSON.parse(await readFile(this.filePath, 'utf8')));
      if (parsed) {
        return parsed;
      }
    } catch {
      // Missing and malformed files both recover to the presentation-only defaults.
    }
    return { ...DEFAULT_DESKTOP_PREFERENCES };
  }

  async write(input: DesktopPreferencesInput): Promise<DesktopPreferences> {
    const preferences = parseDesktopPreferences({ schemaVersion: 1, ...input });
    if (!preferences) {
      throw new Error('Invalid desktop preferences.');
    }
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(preferences, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
    return preferences;
  }
}
