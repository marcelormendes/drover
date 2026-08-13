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
  const model = tokens.model;
  const thinking = tokens.thinking;
  if (model || thinking) {
    segments.push({
      id: 'model',
      text: [model, thinking].filter(Boolean).join(' · '),
    });
  }
  const cwd = tokens.cwd;
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

  const input = numericToken(tokens.input_tokens);
  if (input && input > 0) {
    segments.push({ id: 'input', text: `in ${formatCompactNumber(input)}` });
  }
  const output = numericToken(tokens.output_tokens);
  if (output && output > 0) {
    segments.push({ id: 'output', text: `out ${formatCompactNumber(output)}` });
  }
  const cacheRead = numericToken(tokens.cache_read_tokens);
  if (cacheRead && cacheRead > 0) {
    segments.push({ id: 'cache', text: `cache ${formatCompactNumber(cacheRead)}` });
  }

  const billing = billingSegment(tokens);
  if (billing) {
    segments.push({ id: 'billing', text: billing });
  }
  return segments;
};

const gitSegment = (tokens: Record<string, string>): StatusSegment | undefined => {
  const branch = tokens.git_branch;
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
  const percent = numericToken(tokens.context_percent);
  const used = numericToken(tokens.context_tokens);
  const window = numericToken(tokens.context_window);
  if (window && window > 0) {
    return `${percent === undefined ? '?' : `${percent.toFixed(1)}%`}/${formatCompactNumber(window)}`;
  }
  return used === undefined ? undefined : `${formatCompactNumber(used)}/?`;
};

const billingSegment = (tokens: Record<string, string>): string | undefined => {
  const parts: string[] = [];
  const cost = numericToken(tokens.cost);
  if (cost && cost > 0) {
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

const numericToken = (value: string | undefined): number | undefined => {
  if (value === undefined || value.length === 0) {
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
