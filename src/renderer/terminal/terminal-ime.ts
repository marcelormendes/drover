import type { Terminal } from '@xterm/xterm';

interface Disposable {
  dispose(): void;
}

/**
 * xterm 6 starts IME composition at the end of its hidden textarea instead of
 * the current selection. Drop stale text after the caret before xterm handles
 * compositionstart so it cannot be re-sent as newly composed input.
 */
export function installTerminalImeMiddleInsertionFix(
  terminal: Pick<Terminal, 'textarea'>,
): Disposable {
  const textarea = terminal.textarea;
  if (!textarea) {
    return { dispose() {} };
  }

  const handleCompositionStart = () => {
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    if (selectionStart === null || selectionEnd === null) {
      return;
    }

    const compositionStart = Math.min(selectionStart, selectionEnd);
    if (compositionStart >= textarea.value.length) {
      return;
    }

    textarea.value = textarea.value.slice(0, compositionStart);
    textarea.setSelectionRange(compositionStart, compositionStart);
  };

  textarea.addEventListener('compositionstart', handleCompositionStart, true);
  return {
    dispose() {
      textarea.removeEventListener('compositionstart', handleCompositionStart, true);
    },
  };
}
