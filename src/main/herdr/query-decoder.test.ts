import { describe, expect, it } from 'vitest';
import { decodeHerdrQueryResult } from '@/main/herdr/query-decoder';

function integrations(output: unknown) {
  const result = decodeHerdrQueryResult({ type: 'get-integration-status' }, output);
  if (result.type !== 'integration-status') throw new Error('Unexpected result');
  return result.integrations;
}

describe('terminal history search decoding', () => {
  const query = {
    type: 'search-pane-output',
    paneId: 'w1:p1',
    terminalId: 'term_123',
    query: 'needle',
    direction: 'first',
  } as const;
  const search = {
    pane_id: query.paneId,
    terminal_id: query.terminalId,
    query: query.query,
    case_sensitive: false,
    match_count: 2,
    match_index: 0,
    cursor: 'opaque',
    preview: 'old needle output',
  };

  it('keeps the engine cursor and selected match context', () => {
    expect(decodeHerdrQueryResult(query, { type: 'pane_search', search })).toEqual({
      type: 'pane-search',
      paneId: 'w1:p1',
      terminalId: 'term_123',
      query: 'needle',
      caseSensitive: false,
      matchCount: 2,
      matchIndex: 0,
      cursor: 'opaque',
      preview: 'old needle output',
    });
  });

  it('accepts an explicit empty result', () => {
    expect(
      decodeHerdrQueryResult(query, {
        type: 'pane_search',
        search: { ...search, match_count: 0, match_index: null, cursor: null, preview: null },
      }),
    ).toMatchObject({ matchCount: 0, matchIndex: null, cursor: null, preview: null });
  });

  it.each([
    { pane_id: 'w1:p2' },
    { terminal_id: 'term_replaced' },
    { query: 'stale query' },
    { case_sensitive: true },
    { match_count: -1 },
    { match_count: Number.MAX_SAFE_INTEGER + 1 },
    { match_index: 2 },
    { match_index: 0.5 },
    { cursor: null },
    { cursor: 'é'.repeat(8193) },
    { preview: 'é'.repeat(8193) },
    { match_count: 0 },
  ])('rejects mismatched or malformed search results: %j', (patch) => {
    expect(() =>
      decodeHerdrQueryResult(query, { type: 'pane_search', search: { ...search, ...patch } }),
    ).toThrow('invalid terminal search');
  });
});

describe('integration status CLI decoding', () => {
  it('decodes current, outdated, repair, legacy and missing states without losing path punctuation', () => {
    const rows = integrations(
      [
        'pi: current (v11) (/Users/Agent (Work)/pi.ts)',
        'omp: outdated (v16 < v18) (C:\\Users\\Agent Name\\omp.ts)',
        'claude: needs repair (v8) (/Users/agent/claude.sh)',
        'codex: outdated (legacy < v9) (/Users/agent/codex.sh)',
        'copilot: not installed (/Users/agent/copilot.sh)',
        'antigravity-cli: current (v2) (/Users/agent/agy.sh)',
        '',
      ].join('\r\n'),
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: 'pi', status: 'current', version: 'v11', path: '/Users/Agent (Work)/pi.ts' },
        {
          id: 'omp',
          status: 'outdated',
          version: 'v16',
          expectedVersion: 'v18',
          path: 'C:\\Users\\Agent Name\\omp.ts',
        },
        {
          id: 'claude',
          status: 'outdated',
          version: 'v8',
          needsRepair: true,
          path: '/Users/agent/claude.sh',
        },
        {
          id: 'codex',
          status: 'outdated',
          version: 'legacy',
          expectedVersion: 'v9',
          path: '/Users/agent/codex.sh',
        },
        { id: 'copilot', status: 'missing', path: '/Users/agent/copilot.sh' },
        { id: 'antigravity_cli', status: 'current', version: 'v2', path: '/Users/agent/agy.sh' },
        { id: 'devin', status: 'unavailable' },
      ]),
    );
  });

  it('ignores syntactically valid providers unknown to this desktop', () => {
    const rows = integrations('future-provider: current (v1) (/tmp/provider.sh)');
    expect(rows.every((row) => row.status === 'unavailable')).toBe(true);
    expect(rows.some((row) => row.id === ('future-provider' as string))).toBe(false);
  });

  it.each([
    '',
    {},
    'codex: installed (/tmp/codex.sh)',
    'codex: current (/tmp/codex.sh)',
    'codex: current (legacy) (/tmp/codex.sh)',
    'codex: current (v4294967296) (/tmp/codex.sh)',
    'codex: outdated (v9 < v8) (/tmp/codex.sh)',
    'codex: current (v9) (/tmp/codex.sh)\ncodex: not installed (/tmp/codex.sh)',
    'antigravity-cli: current (v1) (/tmp/a)\nantigravity_cli: current (v1) (/tmp/a)',
    'codex: current (v9) (/tmp/\u0000codex.sh)',
    'codex: current (v9) (/tmp/codex.sh)\nUnexpected warning on stdout',
  ])('rejects malformed or contradictory status output %#', (output) => {
    expect(() => integrations(output)).toThrow('invalid integration status response');
  });
});
