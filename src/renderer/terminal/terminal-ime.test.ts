import { describe, expect, it, vi } from 'vitest';

import { installTerminalImeMiddleInsertionFix } from '@/renderer/terminal/terminal-ime';

function terminalWithTextarea(textarea: HTMLTextAreaElement) {
  return { textarea };
}

describe('installTerminalImeMiddleInsertionFix', () => {
  it('removes stale text after the caret before xterm records the composition start', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'abc';
    textarea.setSelectionRange(0, 0);
    const recordedStarts: number[] = [];

    const fix = installTerminalImeMiddleInsertionFix(terminalWithTextarea(textarea));
    textarea.addEventListener('compositionstart', () => recordedStarts.push(textarea.value.length));

    textarea.dispatchEvent(new CompositionEvent('compositionstart'));

    expect(textarea.value).toBe('');
    expect(textarea.selectionStart).toBe(0);
    expect(recordedStarts).toEqual([0]);
    fix.dispose();
  });

  it('keeps text before the caret and leaves end-of-line composition unchanged', () => {
    const textarea = document.createElement('textarea');
    const fix = installTerminalImeMiddleInsertionFix(terminalWithTextarea(textarea));

    textarea.value = 'abc';
    textarea.setSelectionRange(1, 1);
    textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    expect(textarea.value).toBe('a');
    expect(textarea.selectionStart).toBe(1);

    textarea.value = 'abc';
    textarea.setSelectionRange(3, 3);
    textarea.dispatchEvent(new CompositionEvent('compositionstart'));
    expect(textarea.value).toBe('abc');
    expect(textarea.selectionStart).toBe(3);
    fix.dispose();
  });

  it('removes its capture listener when disposed', () => {
    const textarea = document.createElement('textarea');
    const removeEventListener = vi.spyOn(textarea, 'removeEventListener');
    const fix = installTerminalImeMiddleInsertionFix(terminalWithTextarea(textarea));

    fix.dispose();

    expect(removeEventListener).toHaveBeenCalledWith(
      'compositionstart',
      expect.any(Function),
      true,
    );
  });
});
