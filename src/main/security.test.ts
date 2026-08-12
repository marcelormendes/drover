import { describe, expect, it } from 'vitest';

import { isAllowedExternalUrl, isTrustedRendererUrl } from '@/main/security';

describe('renderer trust boundary', () => {
  it('accepts the packaged file and configured Vite development origin', () => {
    const packagedUrl = 'file:///Applications/Drover.app/index.html';
    expect(isTrustedRendererUrl(packagedUrl, packagedUrl)).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5173/index.html', 'http://localhost:5173')).toBe(
      true,
    );
  });

  it('rejects remote and lookalike renderer origins', () => {
    expect(isTrustedRendererUrl('https://example.com', 'file:///app/index.html')).toBe(false);
    expect(isTrustedRendererUrl('file:///tmp/other.html', 'file:///app/index.html')).toBe(false);
    expect(isTrustedRendererUrl('http://localhost.evil.test:5173', 'http://localhost:5173')).toBe(
      false,
    );
  });
});

describe('external navigation allowlist', () => {
  it('allows Herdr documentation and repository links only over HTTPS', () => {
    expect(isAllowedExternalUrl('https://github.com/herdrdev/herdr#installation')).toBe(true);
    expect(isAllowedExternalUrl('https://herdr.dev/docs')).toBe(true);
    expect(isAllowedExternalUrl('http://github.com/herdrdev/herdr')).toBe(false);
    expect(isAllowedExternalUrl('https://github.com/another-org/repository')).toBe(false);
  });

  it('allows only the Drover latest-release page for desktop updates', () => {
    expect(isAllowedExternalUrl('https://github.com/marcelormendes/drover/releases/latest')).toBe(
      true,
    );
    expect(
      isAllowedExternalUrl('https://github.com/marcelormendes/drover/releases/tag/v0.1.7'),
    ).toBe(false);
    expect(isAllowedExternalUrl('https://github.com/marcelormendes/drover')).toBe(false);
    expect(
      isAllowedExternalUrl('https://github.com/marcelormendes/other-repo/releases/latest'),
    ).toBe(false);
  });
});
