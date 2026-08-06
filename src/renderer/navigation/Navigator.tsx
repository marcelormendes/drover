import { Bot, FolderKanban, Search, SquareTerminal } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  buildNavigatorRows,
  moveNavigatorSelection,
  type NavigatorFilter,
  type NavigatorRow,
} from '@/renderer/navigation/navigator-model';
import type { SessionSnapshot } from '@/shared/herdr';

export interface NavigatorProps {
  snapshot: SessionSnapshot;
  onFocusWorkspace: (workspaceId: string) => void;
  onFocusTab: (tabId: string) => void;
  onFocusPane: (paneId: string) => void;
}

const filters: Array<{ label: string; value: NavigatorFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Working', value: 'working' },
  { label: 'Idle', value: 'idle' },
  { label: 'Done', value: 'done' },
];

function optionId(row: NavigatorRow) {
  return `navigator-${row.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function Navigator({ snapshot, onFocusWorkspace, onFocusTab, onFocusPane }: NavigatorProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<NavigatorFilter>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rows = useMemo(
    () => buildNavigatorRows(snapshot, { query, filter }),
    [filter, query, snapshot],
  );
  const selectedRow = rows[selectedIndex];

  useEffect(() => {
    setSelectedIndex((current) => {
      if (rows.length === 0) {
        return -1;
      }
      return Math.max(0, Math.min(current, rows.length - 1));
    });
  }, [rows.length]);

  const focusRow = (row: NavigatorRow | undefined) => {
    if (!row) {
      return;
    }
    if (row.kind === 'workspace') {
      onFocusWorkspace(row.id);
    } else if (row.kind === 'tab') {
      onFocusTab(row.id);
    } else {
      onFocusPane(row.id);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const move =
      event.key === 'ArrowUp'
        ? 'previous'
        : event.key === 'ArrowDown'
          ? 'next'
          : event.key === 'Home'
            ? 'first'
            : event.key === 'End'
              ? 'last'
              : null;
    if (move) {
      event.preventDefault();
      setSelectedIndex((current) => moveNavigatorSelection(rows.length, current, move));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      focusRow(selectedRow);
    }
  };

  return (
    <Card className="min-h-0 gap-0 overflow-hidden bg-secondary-background">
      <CardHeader className="border-b-2 border-border">
        <CardTitle className="flex items-center gap-2">
          <Search aria-hidden="true" className="size-5" />
          Session navigator
          <Badge className="ml-auto" variant="neutral">
            {rows.length}
          </Badge>
        </CardTitle>
        <Input
          aria-label="Search session"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Workspace, tab, pane, or agent"
          type="search"
          value={query}
        />
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Agent status filter</legend>
          {filters.map((item) => (
            <Button
              aria-pressed={filter === item.value}
              className="h-8 px-3"
              key={item.value}
              onClick={() => {
                setFilter(item.value);
                setSelectedIndex(0);
              }}
              size="sm"
              type="button"
              variant={filter === item.value ? 'noShadow' : 'neutral'}
            >
              {item.label}
            </Button>
          ))}
        </fieldset>
      </CardHeader>
      <CardContent className="min-h-0 p-3">
        {rows.length === 0 ? (
          <div className="rounded-base border-2 border-dashed border-border bg-background p-6 text-center text-sm">
            No matching session targets
          </div>
        ) : (
          <div
            aria-activedescendant={selectedRow ? optionId(selectedRow) : undefined}
            aria-label="Session targets"
            className="space-y-2 outline-none"
            onKeyDown={handleKeyDown}
            role="listbox"
            tabIndex={0}
          >
            {rows.map((row, index) => {
              const Icon =
                row.kind === 'workspace' ? FolderKanban : row.kind === 'tab' ? Bot : SquareTerminal;
              const selected = index === selectedIndex;
              return (
                <button
                  aria-selected={selected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-base border-2 border-border bg-background p-3 text-left transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2',
                    selected ? 'translate-x-0 translate-y-0 bg-main shadow-none' : 'shadow-shadow',
                    row.depth === 1 && 'ml-4 w-[calc(100%-1rem)]',
                    row.depth === 2 && 'ml-8 w-[calc(100%-2rem)]',
                  )}
                  id={optionId(row)}
                  key={row.key}
                  onClick={() => focusRow(row)}
                  onFocus={() => setSelectedIndex(index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  role="option"
                  type="button"
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-heading">{row.label}</span>
                    <span className="block truncate text-xs opacity-70">{row.meta}</span>
                  </span>
                  <Badge variant={row.current ? 'default' : 'neutral'}>{row.status}</Badge>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
