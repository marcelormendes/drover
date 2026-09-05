import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConversationStatusStrip } from '@/renderer/chat/ConversationStatusStrip';
import type { PaneInfo } from '@/shared/herdr';

afterEach(cleanup);

function metadata(tokens: Record<string, string>, extra: Partial<PaneInfo> = {}) {
  return render(<ConversationStatusStrip pane={{ ...extra, tokens } as PaneInfo} />);
}

describe('ConversationStatusStrip', () => {
  it.each(['pi', 'omp', 'codex', 'claude'])(
    'shows reported model, effort and usage for %s',
    (agent) => {
      const { container } = metadata(
        { model: 'reported-model', thinking: 'high', input_tokens: '1200', output_tokens: '34' },
        { agent },
      );
      expect(container).toHaveTextContent('reported-model · high');
      expect(container).toHaveTextContent('in 1.2K');
      expect(container).toHaveTextContent('out 34');
    },
  );

  it('uses engine cwd, then foreground cwd, then pane cwd', () => {
    const pane: PaneInfo = {
      pane_id: 'w1:p1',
      terminal_id: 't1',
      workspace_id: 'w1',
      tab_id: 'tab1',
      focused: true,
      agent_status: 'idle',
      state_labels: {},
      tokens: {},
      revision: 1,
      cwd: '/repo/start',
      foreground_cwd: '/repo/current',
    };
    const { container, rerender } = metadata({ cwd: '/repo/reported' }, pane);
    expect(container).toHaveTextContent('/repo/reported');
    rerender(<ConversationStatusStrip pane={{ ...pane, tokens: {} } as PaneInfo} />);
    expect(container).toHaveTextContent('/repo/current');
    rerender(
      <ConversationStatusStrip
        pane={{ ...pane, tokens: { cwd: ' ' }, foreground_cwd: undefined } as PaneInfo}
      />,
    );
    expect(container).toHaveTextContent('/repo/start');
  });

  it('preserves the full directory in the tooltip', () => {
    const { getByTitle } = metadata({ cwd: '/Users/example/work/project' });
    expect(getByTitle('/Users/example/work/project')).toHaveTextContent('~/work/project');
  });

  it('labels per-response measurements so they are not mistaken for session totals', () => {
    const { container } = metadata({
      usage_scope: 'last_response',
      input_tokens: '100',
      cache_write_tokens: '25',
    });
    expect(container).toHaveTextContent('last response');
    expect(container).toHaveTextContent('cache write 25');
    expect(container).not.toHaveTextContent('session usage');
  });

  it('distinguishes observed zero usage and cost from unavailable data', () => {
    const { container } = metadata({
      input_tokens: '0',
      output_tokens: '0',
      cache_read_tokens: '0',
      cost: '0',
    });
    expect(container).toHaveTextContent('in 0');
    expect(container).toHaveTextContent('out 0');
    expect(container).toHaveTextContent('cache 0');
    expect(container).toHaveTextContent('$0.00');
  });

  it('omits missing and malformed values without inventing usage or model defaults', () => {
    const { container } = metadata({
      model: ' ',
      thinking: '',
      input_tokens: ' ',
      output_tokens: '-1',
      cache_read_tokens: 'NaN',
      cost: 'Infinity',
      context_percent: 'unknown',
    });
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [{ context_percent: '42' }, '42.0% context'],
    [{ context_tokens: '25000', context_window: '100000' }, '25.0%/100K'],
    [{ context_percent: '30', context_tokens: '25000', context_window: '100000' }, '30.0%/100K'],
    [{ context_window: '100000' }, '?/100K'],
    [{ context_tokens: '0' }, '0/?'],
  ] as [Record<string, string>, string][])(
    'renders partial context measurements %j',
    (tokens, expected) => {
      expect(metadata(tokens).container).toHaveTextContent(expected);
    },
  );
});
