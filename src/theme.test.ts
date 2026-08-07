import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync('src/index.css', 'utf8');
const document = readFileSync('index.html', 'utf8');
const lightTheme = stylesheet.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || '';
const darkTheme = stylesheet.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] || '';

describe('Herdr dark palette', () => {
  it.each([
    ['background', '#0f0f10'],
    ['secondary-background', '#1a1a1d'],
    ['foreground', '#e6e6e6'],
    ['main', '#4d9eff'],
    ['main-foreground', '#0f0f10'],
    ['border', '#3f3f46'],
    ['ring', '#4d9eff'],
    ['accent-surface', '#232327'],
    ['accent-surface-foreground', '#e6e6e6'],
    ['thinking-foreground', '#94a3b8'],
    ['response-foreground', '#f1f5f9'],
    ['chart-1', '#4d9eff'],
    ['chart-2', '#f85149'],
    ['chart-3', '#e3b341'],
    ['chart-4', '#3fb950'],
    ['chart-5', '#58c4dc'],
  ])('defines the %s token from the neutral AOP-style palette', (token, color) => {
    expect(darkTheme).toContain(`--${token}: ${color};`);
  });

  it('exposes the dark violet conversation surface to Tailwind utilities', () => {
    expect(stylesheet).toContain('--color-accent-surface: var(--accent-surface);');
    expect(stylesheet).toContain(
      '--color-accent-surface-foreground: var(--accent-surface-foreground);',
    );
  });

  it('defines readable light conversation colors and exposes both color utilities', () => {
    expect(lightTheme).toContain('--thinking-foreground: #64748b;');
    expect(lightTheme).toContain('--response-foreground: #111827;');
    expect(stylesheet).toContain('--color-thinking-foreground: var(--thinking-foreground);');
    expect(stylesheet).toContain('--color-response-foreground: var(--response-foreground);');
  });
});

describe('Herdr renderer content policy', () => {
  it('allows local blob URLs used by pasted-image previews', () => {
    expect(document).toMatch(/img-src[^;]*\bblob:/);
  });
});
