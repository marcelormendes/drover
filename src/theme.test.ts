import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const document = readFileSync('index.html', 'utf8');

describe('Herdr renderer content policy', () => {
  it('allows local blob URLs used by pasted-image previews', () => {
    expect(document).toMatch(/img-src[^;]*\bblob:/);
  });
});
