import { cn } from '@/lib/utils';
import type { AgentStatus } from '@/shared/herdr';
import type { DesktopPreferences } from '@/shared/preferences';

export const statusStyle: Record<AgentStatus, string> = {
  working: 'bg-chart-3',
  blocked: 'bg-chart-2',
  done: 'bg-chart-4',
  idle: 'bg-secondary-background',
  unknown: 'bg-accent-surface',
};

const statusSymbol: Record<AgentStatus, string> = {
  working: '●',
  blocked: '!',
  done: '✓',
  idle: '○',
  unknown: '?',
};

export function statusDotClass(status: AgentStatus): string {
  return cn(
    'size-2.5 shrink-0 rounded-full border-2 border-border',
    statusStyle[status],
    status === 'working' && 'animate-pulse',
  );
}

export function StatusDot({
  status,
  style = 'dot',
}: {
  status: AgentStatus;
  style?: DesktopPreferences['indicatorStyle'];
}) {
  if (style === 'symbol') {
    return (
      <span aria-label={status} className="font-heading" role="img">
        {statusSymbol[status]}
      </span>
    );
  }
  return (
    <>
      <span aria-hidden="true" className={statusDotClass(status)} />
      <span className="sr-only">{status}</span>
    </>
  );
}
