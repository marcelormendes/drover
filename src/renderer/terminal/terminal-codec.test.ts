import { describe, expect, it } from 'vitest';

import { decodeTerminalBytes } from '@/renderer/terminal/terminal-codec';

describe('decodeTerminalBytes', () => {
  it('decodes Herdr base64 frames without treating terminal bytes as text', () => {
    expect([...decodeTerminalBytes('G1sySg==')]).toEqual([27, 91, 50, 74]);
    expect([...decodeTerminalBytes('/wA=')]).toEqual([255, 0]);
  });
});
