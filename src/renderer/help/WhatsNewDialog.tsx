import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface WhatsNewDialogProps {
  open: boolean;
  version: string;
  restartNeeded: boolean;
  canLiveHandoff: boolean;
  onOpenChange: (open: boolean) => void;
  onLiveHandoff: () => void;
}

const releaseItems = [
  {
    title: 'Complete graphical Herdr control',
    detail:
      'Spaces, tabs, panes, worktrees, agents, Navigator, settings, and help stay engine-owned.',
  },
  {
    title: 'Terminal power tools',
    detail:
      'Search, copy, safe links, canonical scrollback, resizing, moving, swapping, and zooming.',
  },
  {
    title: 'Reliable desktop sessions',
    detail:
      'The event stream reconnects from a fresh snapshot while Herdr keeps every process alive.',
  },
] as const;

export function WhatsNewDialog({
  open,
  version,
  restartNeeded,
  canLiveHandoff,
  onOpenChange,
  onLiveHandoff,
}: WhatsNewDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>What's new in {version}</DialogTitle>
          <DialogDescription>
            Drover translates the current TUI experience into a native graphical workflow.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {releaseItems.map((item, index) => (
            <article
              className="rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow"
              key={item.title}
            >
              <div className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-base border-2 border-border bg-main font-heading text-main-foreground">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-heading">{item.title}</h3>
                  <p className="mt-1 text-sm leading-6 opacity-80">{item.detail}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
        {restartNeeded ? (
          <div
            aria-live="polite"
            className="rounded-base border-2 border-border bg-main p-4 text-sm text-main-foreground"
          >
            A newer Herdr engine is ready. Live handoff preserves supported processes and layout.
          </div>
        ) : null}
        <DialogFooter>
          {restartNeeded && canLiveHandoff ? (
            <Button onClick={onLiveHandoff}>
              <RefreshCw aria-hidden="true" /> Restart Herdr without losing session
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
