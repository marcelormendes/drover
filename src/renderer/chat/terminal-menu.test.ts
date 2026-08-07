import { describe, expect, it } from 'vitest';

import { detectTerminalMenu, menuSelectionKeys } from '@/renderer/chat/terminal-menu';

const piModelMenu = [
  'Only showing models from configured providers. Use',
  '/login to add providers.',
  '',
  '>',
  '',
  '→ deepseek-v4-flash [opencode-go] ✓',
  '  k3 [kimi-coding]',
  '  k3-256k [kimi-coding]',
  '  kimi-for-coding [kimi-coding]',
  '  gpt-5.4 [openai-codex]',
  '  (1/30)',
  '',
  '  Model Name: DeepSeek V4 Flash (New)',
  '',
  '──────────────────────────────────────',
  '/private/tmp/herdr-menu-probe (main)',
].join('\n');

describe('detectTerminalMenu', () => {
  it('reads the pi model selector exactly as rendered on the pane', () => {
    const menu = detectTerminalMenu(piModelMenu);

    expect(menu).not.toBeNull();
    expect(menu?.options).toEqual([
      'deepseek-v4-flash [opencode-go] ✓',
      'k3 [kimi-coding]',
      'k3-256k [kimi-coding]',
      'kimi-for-coding [kimi-coding]',
      'gpt-5.4 [openai-codex]',
    ]);
    expect(menu?.selectedIndex).toBe(0);
    expect(menu?.position).toBe('1/30');
  });

  it('tracks a highlight that sits in the middle of the visible window', () => {
    const menu = detectTerminalMenu(
      ['  alpha [one]', '  beta [two]', '❯ gamma [three]', '  delta [four]'].join('\n'),
    );

    expect(menu?.options).toEqual(['alpha [one]', 'beta [two]', 'gamma [three]', 'delta [four]']);
    expect(menu?.selectedIndex).toBe(2);
  });

  it('ignores shell prompts and plain output without sibling options', () => {
    expect(detectTerminalMenu('~/code/herdr ❯ echo hi\nhi\n~/code/herdr ❯')).toBeNull();
    expect(detectTerminalMenu('→ single arrowed line\n\nno options here')).toBeNull();
    expect(detectTerminalMenu('[Skills]\n  one, two, three\n  four, five')).toBeNull();
  });

  it('does not resurrect an old wrapped prompt after a newer prompt is visible', () => {
    expect(
      detectTerminalMenu(
        [
          '› Review the chat image paste feature in the working tree.',
          '  Read the exact files and report findings as a numbered list.',
          '  Review only — do not edit files.',
          '• Completed the review.',
          '› Explain this codebase',
        ].join('\n'),
      ),
    ).toBeNull();
  });

  it('does not treat a wrapped Claude prompt as a menu after the empty composer appears', () => {
    expect(
      detectTerminalMenu(
        [
          '❯ Test the MG3.0 changes with /Users/marcelorm/Downloads/Rentvine Test Report with',
          '  utility columns 8_3_26 (1).csv',
          '',
          '⏺ Searching for patterns…',
          '',
          '────────────────',
          '❯ ',
          '────────────────',
        ].join('\n'),
      ),
    ).toBeNull();
  });

  it('plans relative arrow presses toward the clicked option', () => {
    const menu = { options: ['a', 'b', 'c', 'd'], selectedIndex: 1 };

    expect(menuSelectionKeys(menu, 3)).toEqual(['down', 'down', 'enter']);
    expect(menuSelectionKeys(menu, 0)).toEqual(['up', 'enter']);
    expect(menuSelectionKeys(menu, 1)).toEqual(['enter']);
  });
});
