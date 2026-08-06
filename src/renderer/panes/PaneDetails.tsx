import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PaneInfo } from '@/shared/herdr';

export interface PaneDetailsProps {
  pane: PaneInfo;
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid gap-1 border-b-2 border-border py-3 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-xs font-heading uppercase tracking-wide">{label}</dt>
      <dd className="min-w-0 break-all text-sm">{value || 'Not reported'}</dd>
    </div>
  );
}

function RecordDetails({
  emptyLabel,
  record,
}: {
  emptyLabel: string;
  record: Record<string, string>;
}) {
  const entries = Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return <p className="text-sm opacity-70">{emptyLabel}</p>;
  }
  return (
    <dl className="divide-y-2 divide-border rounded-base border-2 border-border bg-background">
      {entries.map(([key, value]) => (
        <div className="grid gap-1 p-3 sm:grid-cols-[10rem_minmax(0,1fr)]" key={key}>
          <dt className="font-heading">{key}</dt>
          <dd className="min-w-0 break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PaneDetails({ pane }: PaneDetailsProps) {
  const scroll = pane.scroll;
  const scrollText = scroll
    ? `${scroll.offset_from_bottom === 0 ? 'At bottom' : `${scroll.offset_from_bottom} lines from bottom`} · ${scroll.max_offset_from_bottom} max · ${scroll.viewport_rows} viewport rows`
    : undefined;

  return (
    <Card aria-label="Pane details" className="gap-0 bg-secondary-background" role="region">
      <CardHeader className="border-b-2 border-border">
        <CardTitle className="flex items-center gap-2">
          Pane details
          <Badge className="ml-auto" variant="neutral">
            {pane.agent_status}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-5">
        <dl>
          <DetailRow label="Working directory" value={pane.cwd} />
          <DetailRow label="Foreground directory" value={pane.foreground_cwd} />
          <DetailRow label="Terminal title" value={pane.terminal_title} />
          <DetailRow label="Scroll position" value={scrollText} />
        </dl>

        <section aria-labelledby={`pane-${pane.pane_id}-state-labels`} className="space-y-3">
          <h3 className="font-heading" id={`pane-${pane.pane_id}-state-labels`}>
            State labels
          </h3>
          <RecordDetails emptyLabel="No state labels" record={pane.state_labels} />
        </section>

        <section aria-labelledby={`pane-${pane.pane_id}-tokens`} className="space-y-3">
          <h3 className="font-heading" id={`pane-${pane.pane_id}-tokens`}>
            Metadata tokens
          </h3>
          <RecordDetails emptyLabel="No metadata tokens" record={pane.tokens} />
        </section>

        <section aria-labelledby={`pane-${pane.pane_id}-session`} className="space-y-3">
          <h3 className="font-heading" id={`pane-${pane.pane_id}-session`}>
            Agent session
          </h3>
          {pane.agent_session ? (
            <dl className="rounded-base border-2 border-border bg-background px-3">
              <DetailRow label="Agent" value={pane.agent_session.agent} />
              <DetailRow label="Kind" value={pane.agent_session.kind} />
              <DetailRow label="Reference" value={pane.agent_session.value} />
              <DetailRow label="Source" value={pane.agent_session.source} />
            </dl>
          ) : (
            <p className="text-sm opacity-70">No agent session</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
