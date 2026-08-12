import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFile(path, 'utf8');

describe('GitHub Pages site', () => {
  it('presents Drover with accessible download and source links', async () => {
    const html = await read('site/index.html');

    expect(html).toContain('<title>Drover');
    expect(html).toContain('name="description"');
    expect(html).toContain('Run the herd without living in the terminal.');
    expect(html).toContain('href="https://github.com/marcelormendes/drover/releases/latest"');
    expect(html).toContain('href="https://github.com/marcelormendes/drover"');
    expect(html).toContain('alt="Drover"');
  });

  it('uses the desktop app neobrutalist palette and responsive layout', async () => {
    const css = await read('site/styles.css');

    expect(css).toContain('--background: #e8effa');
    expect(css).toContain('--main: #6e91ff');
    expect(css).toContain('border: 2px solid var(--border)');
    expect(css).toContain('box-shadow: 4px 4px 0 var(--border)');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('builds a static artifact with the app icon', async () => {
    const packageInfo = JSON.parse(await read('package.json')) as {
      scripts: Record<string, string>;
    };
    const buildScript = await read('scripts/build-site.mjs');

    expect(packageInfo.scripts['site:build']).toBe('node scripts/build-site.mjs');
    expect(packageInfo.scripts.verify).toContain('npm run site:build');
    expect(buildScript).toContain("copyFile(path.join(root, 'resources', 'icon-1024.png')");
    expect(buildScript).toContain("writeFile(path.join(output, '.nojekyll')");
  });

  it('deploys Pages from main with pinned actions and minimum permissions', async () => {
    const workflow = await read('.github/workflows/pages.yml');

    expect(workflow).toContain('pages: write');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('environment:\n      name: github-pages');
    expect(workflow).toContain('path: dist/site');
    const uses = [...workflow.matchAll(/^[ \t]+uses:\s+([^\s#]+)/gmu)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action).toMatch(/@[0-9a-f]{40}$/u);
    }
  });
});
