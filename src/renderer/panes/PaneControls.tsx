import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Eraser,
  Maximize2,
  Move,
  PanelBottom,
  PanelRight,
  Pencil,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useId, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PaneInfo, TabInfo, WorkspaceInfo } from '@/shared/herdr';

export type PaneDirection = 'left' | 'right' | 'up' | 'down';
export type PaneSplitDirection = 'right' | 'down';

export interface PaneDirectionalIntent {
  paneId: string;
  direction: PaneDirection;
}

export interface PaneResizeIntent extends PaneDirectionalIntent {
  amount: number;
}

export interface PaneSplitIntent {
  paneId: string;
  direction: PaneSplitDirection;
}

export type PaneMoveDestination =
  | { type: 'tab'; tabId: string; split: PaneSplitDirection }
  | { type: 'new-tab'; workspaceId: string; label?: string }
  | { type: 'new-workspace'; label?: string; tabLabel?: string };

export interface PaneMoveIntent {
  paneId: string;
  destination: PaneMoveDestination;
}

export interface MovePaneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pane: PaneInfo;
  tabs: readonly TabInfo[];
  workspaces: readonly WorkspaceInfo[];
  busy?: boolean;
  error?: string;
  onMove: (intent: PaneMoveIntent) => void;
}

export interface PaneControlsProps {
  pane: PaneInfo;
  tabs: readonly TabInfo[];
  workspaces: readonly WorkspaceInfo[];
  busy?: boolean;
  moveError?: string;
  onFocusDirection: (intent: PaneDirectionalIntent) => void;
  onSwapDirection: (intent: PaneDirectionalIntent) => void;
  onResizeDirection: (intent: PaneResizeIntent) => void;
  onSplit: (intent: PaneSplitIntent) => void;
  onZoom: (paneId: string) => void;
  onRename: (paneId: string) => void;
  onClearName: (paneId: string) => void;
  onClose: (paneId: string) => void;
  onMove: (intent: PaneMoveIntent) => void;
}

const directions: PaneDirection[] = ['left', 'right', 'up', 'down'];
const directionIcons = {
  left: ArrowLeft,
  right: ArrowRight,
  up: ArrowUp,
  down: ArrowDown,
};

type MoveMode = 'tab' | 'new-tab' | 'new-workspace';

const optionalValue = (value: string) => value.trim() || undefined;

export function MovePaneDialog({
  open,
  onOpenChange,
  pane,
  tabs,
  workspaces,
  busy = false,
  error,
  onMove,
}: MovePaneDialogProps) {
  const newTabLabelId = useId();
  const newWorkspaceLabelId = useId();
  const newWorkspaceTabLabelId = useId();
  const orderedWorkspaces = useMemo(
    () =>
      [...workspaces].sort(
        (left, right) =>
          left.number - right.number || left.workspace_id.localeCompare(right.workspace_id),
      ),
    [workspaces],
  );
  const workspaceById = useMemo(
    () => new Map(orderedWorkspaces.map((workspace) => [workspace.workspace_id, workspace])),
    [orderedWorkspaces],
  );
  const destinationTabs = useMemo(
    () =>
      tabs
        .filter((tab) => tab.tab_id !== pane.tab_id)
        .sort((left, right) => {
          const leftWorkspace = workspaceById.get(left.workspace_id)?.number ?? 0;
          const rightWorkspace = workspaceById.get(right.workspace_id)?.number ?? 0;
          return (
            leftWorkspace - rightWorkspace ||
            left.number - right.number ||
            left.tab_id.localeCompare(right.tab_id)
          );
        }),
    [pane.tab_id, tabs, workspaceById],
  );
  const [mode, setMode] = useState<MoveMode>('tab');
  const [selectedTabId, setSelectedTabId] = useState(destinationTabs[0]?.tab_id);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    pane.workspace_id || orderedWorkspaces[0]?.workspace_id,
  );
  const [split, setSplit] = useState<PaneSplitDirection>('right');
  const [newTabLabel, setNewTabLabel] = useState('');
  const [newWorkspaceLabel, setNewWorkspaceLabel] = useState('');
  const [newWorkspaceTabLabel, setNewWorkspaceTabLabel] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (mode === 'tab') {
      if (!selectedTabId) {
        return;
      }
      onMove({ paneId: pane.pane_id, destination: { type: 'tab', tabId: selectedTabId, split } });
      return;
    }
    if (mode === 'new-tab') {
      if (!selectedWorkspaceId) {
        return;
      }
      onMove({
        paneId: pane.pane_id,
        destination: {
          type: 'new-tab',
          workspaceId: selectedWorkspaceId,
          label: optionalValue(newTabLabel),
        },
      });
      return;
    }
    onMove({
      paneId: pane.pane_id,
      destination: {
        type: 'new-workspace',
        label: optionalValue(newWorkspaceLabel),
        tabLabel: optionalValue(newWorkspaceTabLabel),
      },
    });
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Move pane</DialogTitle>
          <DialogDescription>
            Choose a destination for {pane.label || pane.pane_id}. Herdr owns the resulting layout.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <fieldset className="space-y-2">
            <legend className="font-heading">Destination type</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['tab', 'Existing tab destination'],
                  ['new-tab', 'New tab destination'],
                  ['new-workspace', 'New workspace destination'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  aria-pressed={mode === value}
                  key={value}
                  onClick={() => setMode(value)}
                  type="button"
                  variant={mode === value ? 'noShadow' : 'neutral'}
                >
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>

          {mode === 'tab' ? (
            <div className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="font-heading">Existing tab</legend>
                {destinationTabs.length === 0 ? (
                  <p className="rounded-base border-2 border-dashed border-border p-4 text-sm">
                    No other tabs are available
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {destinationTabs.map((tab) => {
                      const workspace = workspaceById.get(tab.workspace_id);
                      const label = `Select tab ${tab.label} in ${workspace?.label || tab.workspace_id}`;
                      return (
                        <Button
                          aria-label={label}
                          aria-pressed={selectedTabId === tab.tab_id}
                          className="h-auto justify-start px-3 py-3 text-left"
                          key={tab.tab_id}
                          onClick={() => setSelectedTabId(tab.tab_id)}
                          type="button"
                          variant={selectedTabId === tab.tab_id ? 'noShadow' : 'neutral'}
                        >
                          <span>
                            <span className="block font-heading">{tab.label}</span>
                            <span className="block text-xs opacity-70">
                              {workspace?.label || tab.workspace_id}
                            </span>
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                )}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="font-heading">Destination split</legend>
                <div className="flex gap-2">
                  {(['right', 'down'] as const).map((direction) => (
                    <Button
                      aria-pressed={split === direction}
                      key={direction}
                      onClick={() => setSplit(direction)}
                      type="button"
                      variant={split === direction ? 'noShadow' : 'neutral'}
                    >
                      {direction === 'right' ? (
                        <PanelRight aria-hidden="true" />
                      ) : (
                        <PanelBottom aria-hidden="true" />
                      )}
                      Split {direction}
                    </Button>
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}

          {mode === 'new-tab' ? (
            <div className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="font-heading">Workspace</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {orderedWorkspaces.map((workspace) => (
                    <Button
                      aria-label={`Select workspace ${workspace.label}`}
                      aria-pressed={selectedWorkspaceId === workspace.workspace_id}
                      className="justify-start"
                      key={workspace.workspace_id}
                      onClick={() => setSelectedWorkspaceId(workspace.workspace_id)}
                      type="button"
                      variant={
                        selectedWorkspaceId === workspace.workspace_id ? 'noShadow' : 'neutral'
                      }
                    >
                      {workspace.label}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor={newTabLabelId}>New tab label</Label>
                <Input
                  id={newTabLabelId}
                  onChange={(event) => setNewTabLabel(event.currentTarget.value)}
                  placeholder="Optional"
                  value={newTabLabel}
                />
              </div>
            </div>
          ) : null}

          {mode === 'new-workspace' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={newWorkspaceLabelId}>New workspace label</Label>
                <Input
                  id={newWorkspaceLabelId}
                  onChange={(event) => setNewWorkspaceLabel(event.currentTarget.value)}
                  placeholder="Optional"
                  value={newWorkspaceLabel}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={newWorkspaceTabLabelId}>New workspace tab label</Label>
                <Input
                  id={newWorkspaceTabLabelId}
                  onChange={(event) => setNewWorkspaceTabLabel(event.currentTarget.value)}
                  placeholder="Optional"
                  value={newWorkspaceTabLabel}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <div
              className="rounded-base border-2 border-border bg-chart-2 p-3 text-sm"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="neutral"
            >
              Cancel
            </Button>
            <Button disabled={busy || (mode === 'tab' && !selectedTabId)} type="submit">
              {busy ? 'Moving pane' : 'Move pane'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DirectionControls({
  action,
  disabled,
  onDirection,
}: {
  action: 'Focus' | 'Swap' | 'Resize';
  disabled: boolean;
  onDirection: (direction: PaneDirection) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-heading">{action}</legend>
      <div className="grid grid-cols-4 gap-2">
        {directions.map((direction) => {
          const Icon = directionIcons[direction];
          return (
            <Button
              aria-label={`${action} pane ${direction}`}
              disabled={disabled}
              key={direction}
              onClick={() => onDirection(direction)}
              size="icon"
              type="button"
              variant="neutral"
            >
              <Icon aria-hidden="true" />
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PaneControls({
  pane,
  tabs,
  workspaces,
  busy = false,
  moveError,
  onFocusDirection,
  onSwapDirection,
  onResizeDirection,
  onSplit,
  onZoom,
  onRename,
  onClearName,
  onClose,
  onMove,
}: PaneControlsProps) {
  const [moveOpen, setMoveOpen] = useState(false);
  return (
    <>
      <Card className="gap-0 bg-secondary-background">
        <CardHeader className="border-b-2 border-border">
          <CardTitle>Pane controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <DirectionControls
              action="Focus"
              disabled={busy}
              onDirection={(direction) => onFocusDirection({ paneId: pane.pane_id, direction })}
            />
            <DirectionControls
              action="Swap"
              disabled={busy}
              onDirection={(direction) => onSwapDirection({ paneId: pane.pane_id, direction })}
            />
            <DirectionControls
              action="Resize"
              disabled={busy}
              onDirection={(direction) =>
                onResizeDirection({ paneId: pane.pane_id, direction, amount: 1 })
              }
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-heading">Topology</legend>
            <div className="flex flex-wrap gap-2">
              <Button
                aria-label="Split pane right"
                disabled={busy}
                onClick={() => onSplit({ paneId: pane.pane_id, direction: 'right' })}
                type="button"
                variant="neutral"
              >
                <PanelRight aria-hidden="true" /> Split right
              </Button>
              <Button
                aria-label="Split pane down"
                disabled={busy}
                onClick={() => onSplit({ paneId: pane.pane_id, direction: 'down' })}
                type="button"
                variant="neutral"
              >
                <PanelBottom aria-hidden="true" /> Split down
              </Button>
              <Button
                aria-label="Toggle pane zoom"
                disabled={busy}
                onClick={() => onZoom(pane.pane_id)}
                type="button"
                variant="neutral"
              >
                <Maximize2 aria-hidden="true" /> Zoom
              </Button>
              <Button
                disabled={busy}
                onClick={() => setMoveOpen(true)}
                type="button"
                variant="neutral"
              >
                <Move aria-hidden="true" /> Move pane
              </Button>
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-heading">Pane</legend>
            <div className="flex flex-wrap gap-2">
              <Button
                aria-label="Rename pane"
                disabled={busy}
                onClick={() => onRename(pane.pane_id)}
                type="button"
                variant="neutral"
              >
                <Pencil aria-hidden="true" /> Rename
              </Button>
              <Button
                aria-label="Clear pane name"
                disabled={busy || !pane.label?.trim()}
                onClick={() => onClearName(pane.pane_id)}
                type="button"
                variant="neutral"
              >
                <Eraser aria-hidden="true" /> Clear name
              </Button>
              <Button
                aria-label="Close pane"
                className="bg-chart-2"
                disabled={busy}
                onClick={() => onClose(pane.pane_id)}
                type="button"
              >
                <Trash2 aria-hidden="true" /> Close
              </Button>
            </div>
          </fieldset>
        </CardContent>
      </Card>
      <MovePaneDialog
        busy={busy}
        error={moveError}
        onMove={(intent) => {
          onMove(intent);
          setMoveOpen(false);
        }}
        onOpenChange={setMoveOpen}
        open={moveOpen}
        pane={pane}
        tabs={tabs}
        workspaces={workspaces}
      />
    </>
  );
}
