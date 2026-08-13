import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ShortcutHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutDefinition {
  category: 'Session' | 'Spaces' | 'Tabs' | 'Panes' | 'Terminal' | 'View';
  action: string;
  keys: string;
}

export const DESKTOP_SHORTCUTS: readonly ShortcutDefinition[] = [
  { category: 'Session', action: 'Open Navigator', keys: '⌘K' },
  { category: 'Session', action: 'Open Settings', keys: '⌘,' },
  { category: 'Session', action: 'Keyboard shortcuts', keys: '⌘?' },
  { category: 'Session', action: 'Refresh Herdr session', keys: '⌘R' },
  { category: 'Spaces', action: 'New workspace', keys: '⌘⇧N' },
  { category: 'Spaces', action: 'Previous workspace', keys: '⌃⇧Tab' },
  { category: 'Spaces', action: 'Next workspace', keys: '⌃Tab' },
  { category: 'Spaces', action: 'Focus workspace 1–9', keys: '⌘1…9' },
  { category: 'Tabs', action: 'New tab', keys: '⌘T' },
  { category: 'Tabs', action: 'Previous tab', keys: '⌘⌥←' },
  { category: 'Tabs', action: 'Next tab', keys: '⌘⌥→' },
  { category: 'Panes', action: 'Focus pane left', keys: '⌥←' },
  { category: 'Panes', action: 'Focus pane right', keys: '⌥→' },
  { category: 'Panes', action: 'Focus pane up', keys: '⌥↑' },
  { category: 'Panes', action: 'Focus pane down', keys: '⌥↓' },
  { category: 'Panes', action: 'Split pane right', keys: '⌘⌥→' },
  { category: 'Panes', action: 'Split pane down', keys: '⌘⌥↓' },
  { category: 'Panes', action: 'Toggle pane zoom', keys: '⌘⇧Z' },
  { category: 'View', action: 'Zoom in', keys: '⌘+' },
  { category: 'View', action: 'Zoom out', keys: '⌘-' },
  { category: 'View', action: 'Reset zoom', keys: '⌘0' },
  { category: 'Terminal', action: 'Search terminal', keys: '⌘F' },
  { category: 'Terminal', action: 'Copy terminal selection', keys: '⌘C' },
] as const;

export function ShortcutHelpDialog({ open, onOpenChange }: ShortcutHelpDialogProps) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) {
      return DESKTOP_SHORTCUTS;
    }
    return DESKTOP_SHORTCUTS.filter((shortcut) =>
      `${shortcut.category} ${shortcut.action} ${shortcut.keys}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [query]);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setQuery('');
        }
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Native desktop equivalents for Herdr navigation and terminal actions.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search shortcuts"
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search actions or keys"
          value={query}
        />
        <ScrollArea className="max-h-[55vh] pr-3">
          <div className="space-y-2 py-1">
            {matches.map((shortcut) => (
              <div
                className="flex items-center gap-3 rounded-base border-2 border-border bg-secondary-background p-3"
                key={`${shortcut.category}:${shortcut.action}`}
              >
                <Badge className="w-20 justify-center" variant="neutral">
                  {shortcut.category}
                </Badge>
                <span className="min-w-0 flex-1 text-sm font-heading">{shortcut.action}</span>
                <kbd className="rounded-base border-2 border-border bg-main px-2 py-1 font-mono text-xs text-main-foreground shadow-[2px_2px_0_0_var(--border)]">
                  {shortcut.keys}
                </kbd>
              </div>
            ))}
            {matches.length === 0 ? (
              <div className="rounded-base border-2 border-dashed border-border p-6 text-center text-sm">
                No shortcuts match “{query}”.
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
