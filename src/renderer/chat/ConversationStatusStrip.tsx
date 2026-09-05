import type { PaneInfo } from '@/shared/herdr';

interface StatusSegment {
  id: string;
  text: string;
  title?: string;
  tone?: 'default' | 'dirty';
}

interface ConversationStatusStripProps {
  pane: PaneInfo;
}

export const ConversationStatusStrip = ({ pane }: ConversationStatusStripProps) => {
  const segments = metadataSegments(pane);
  if (segments.length === 0) {
    return null;
  }

  return (
    <div
      className="flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap font-mono text-[10px] leading-4 text-muted-foreground"
      data-slot="agent-metadata"
    >
      {segments.map((segment, index) => (
        <span className="contents" key={segment.id}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <span
            className={segment.tone === 'dirty' ? 'text-main' : undefined}
            title={segment.title}
          >
            {segment.text}
          </span>
        </span>
      ))}
    </div>
  );
};

const metadataSegments = (pane: PaneInfo): StatusSegment[] => {
  const tokens = pane.tokens ?? {};
  const segments: StatusSegment[] = [];
  const model = nonemptyToken(tokens.model);
  const thinking = nonemptyToken(tokens.thinking);
  if (model || thinking) {
    segments.push({
      id: 'model',
      text: [model, thinking].filter(Boolean).join(' · '),
    });
  }
  const cwd =
    nonemptyToken(tokens.cwd) ?? nonemptyToken(pane.foreground_cwd) ?? nonemptyToken(pane.cwd);
  if (cwd) {
    segments.push({ id: 'cwd', text: compactPath(cwd), title: cwd });
  }

  const git = gitSegment(tokens);
  if (git) {
    segments.push(git);
  }

  const context = contextSegment(tokens);
  if (context) {
    segments.push({ id: 'context', text: context });
  }

  const usageScope = tokens.usage_scope;
  if (usageScope === 'last_response' || usageScope === 'session') {
    segments.push({
      id: 'usage-scope',
      text: usageScope === 'last_response' ? 'last response' : 'session usage',
    });
  }
  const input = numericToken(tokens.input_tokens);
  if (input !== undefined) {
    segments.push({ id: 'input', text: `in ${formatCompactNumber(input)}` });
  }
  const output = numericToken(tokens.output_tokens);
  if (output !== undefined) {
    segments.push({ id: 'output', text: `out ${formatCompactNumber(output)}` });
  }
  const cacheRead = numericToken(tokens.cache_read_tokens);
  if (cacheRead !== undefined) {
    segments.push({ id: 'cache', text: `cache ${formatCompactNumber(cacheRead)}` });
  }

  const cacheWrite = numericToken(tokens.cache_write_tokens);
  if (cacheWrite !== undefined) {
    segments.push({ id: 'cache-write', text: `cache write ${formatCompactNumber(cacheWrite)}` });
  }

  const billing = billingSegment(tokens);
  if (billing) {
    segments.push({ id: 'billing', text: billing });
  }
  return segments;
};

const gitSegment = (tokens: Record<string, string>): StatusSegment | undefined => {
  const branch = nonemptyToken(tokens.git_branch);
  const unstaged = numericToken(tokens.git_unstaged) ?? 0;
  const staged = numericToken(tokens.git_staged) ?? 0;
  const untracked = numericToken(tokens.git_untracked) ?? 0;
  if (!branch && unstaged === 0 && staged === 0 && untracked === 0) {
    return undefined;
  }
  const parts = branch ? [branch] : [];
  if (unstaged > 0) {
    parts.push(`*${unstaged}`);
  }
  if (staged > 0) {
    parts.push(`+${staged}`);
  }
  if (untracked > 0) {
    parts.push(`?${untracked}`);
  }
  return {
    id: 'git',
    text: parts.join(' '),
    tone: unstaged > 0 || staged > 0 || untracked > 0 ? 'dirty' : 'default',
  };
};

const contextSegment = (tokens: Record<string, string>): string | undefined => {
  const reportedPercent = numericToken(tokens.context_percent);
  const used = numericToken(tokens.context_tokens);
  const window = numericToken(tokens.context_window);
  const percent =
    reportedPercent ??
    (used !== undefined && window && window > 0 ? (used / window) * 100 : undefined);
  if (window && window > 0) {
    return `${percent === undefined ? '?' : `${percent.toFixed(1)}%`}/${formatCompactNumber(window)}`;
  }
  if (percent !== undefined) {
    return `${percent.toFixed(1)}% context`;
  }
  return used === undefined ? undefined : `${formatCompactNumber(used)}/?`;
};

const billingSegment = (tokens: Record<string, string>): string | undefined => {
  const parts: string[] = [];
  const cost = numericToken(tokens.cost);
  if (cost !== undefined) {
    parts.push(`$${cost.toFixed(2)}`);
  }
  const premiumRequests = numericToken(tokens.premium_requests);
  if (premiumRequests && premiumRequests > 0) {
    parts.push(`premium ${formatCompactNumber(premiumRequests)}`);
  }
  if (tokens.subscription === 'true') {
    parts.push('(sub)');
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
};

const nonemptyToken = (value: string | undefined): string | undefined => value?.trim() || undefined;

const numericToken = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

const formatCompactNumber = (number: number): string => {
  if (number < 1_000) {
    return String(number);
  }
  if (number < 10_000) {
    return `${trimOneDecimal(number / 1_000)}K`;
  }
  if (number < 1_000_000) {
    return `${Math.round(number / 1_000)}K`;
  }
  if (number < 10_000_000) {
    return `${trimOneDecimal(number / 1_000_000)}M`;
  }
  if (number < 1_000_000_000) {
    return `${Math.round(number / 1_000_000)}M`;
  }
  if (number < 10_000_000_000) {
    return `${trimOneDecimal(number / 1_000_000_000)}B`;
  }
  return `${Math.round(number / 1_000_000_000)}B`;
};

const trimOneDecimal = (number: number): string => {
  const fixed = number.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
};

const compactPath = (cwd: string): string =>
  cwd
    .replace(/^\/home\/[^/]+(?=\/|$)/, '~')
    .replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, '~');
