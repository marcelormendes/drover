import { describe, expect, it } from 'vitest';

import { resolveHerdrBinary } from '@/main/herdr/binary-locator';

const canExecute = (executable: Set<string>) => (file: string) => executable.has(file);

describe('resolveHerdrBinary', () => {
  it('prefers HERDR_DESKTOP_BIN when it is executable', () => {
    const canRun = canExecute(new Set(['/opt/herdr/bin/herdr']));
    expect(
      resolveHerdrBinary({
        envBinary: '/opt/herdr/bin/herdr',
        home: '/Users/me',
        pathEntries: [],
        canExecute: canRun,
      }),
    ).toBe('/opt/herdr/bin/herdr');
  });

  it('returns herdr from the PATH when HERDR_DESKTOP_BIN is unset', () => {
    const canRun = canExecute(new Set(['/usr/local/bin/herdr']));
    expect(
      resolveHerdrBinary({
        home: '/Users/me',
        pathEntries: ['/usr/bin', '/usr/local/bin'],
        canExecute: canRun,
      }),
    ).toBe('herdr');
  });

  it('ignores HERDR_DESKTOP_BIN when it is not executable and falls back to the PATH', () => {
    const canRun = canExecute(new Set(['/usr/bin/herdr']));
    expect(
      resolveHerdrBinary({
        envBinary: '/missing/herdr',
        home: '/Users/me',
        pathEntries: ['/usr/bin'],
        canExecute: canRun,
      }),
    ).toBe('herdr');
  });

  it('finds herdr in ~/.local/bin when it is not on the PATH', () => {
    const canRun = canExecute(new Set(['/Users/me/.local/bin/herdr']));
    expect(
      resolveHerdrBinary({
        home: '/Users/me',
        pathEntries: ['/usr/bin', '/bin'],
        canExecute: canRun,
      }),
    ).toBe('/Users/me/.local/bin/herdr');
  });

  it('finds herdr in /opt/homebrew/bin before /usr/local/bin', () => {
    const canRun = canExecute(new Set(['/opt/homebrew/bin/herdr', '/usr/local/bin/herdr']));
    expect(
      resolveHerdrBinary({
        home: '/Users/me',
        pathEntries: ['/usr/bin'],
        canExecute: canRun,
      }),
    ).toBe('/opt/homebrew/bin/herdr');
  });

  it('falls back to /usr/local/bin/herdr for Intel macs', () => {
    const canRun = canExecute(new Set(['/usr/local/bin/herdr']));
    expect(
      resolveHerdrBinary({
        home: '/Users/me',
        pathEntries: ['/usr/bin'],
        canExecute: canRun,
      }),
    ).toBe('/usr/local/bin/herdr');
  });

  it('returns null when no candidate is executable', () => {
    expect(
      resolveHerdrBinary({
        envBinary: '/missing/herdr',
        home: '/Users/me',
        pathEntries: ['/usr/bin'],
        canExecute: () => false,
      }),
    ).toBeNull();
  });

  it('ignores empty PATH entries and missing home', () => {
    const canRun = canExecute(new Set(['/Users/me/.local/bin/herdr']));
    expect(
      resolveHerdrBinary({
        home: '/Users/me',
        pathEntries: ['', '/usr/bin', ''],
        canExecute: canRun,
      }),
    ).toBe('/Users/me/.local/bin/herdr');
  });
});
