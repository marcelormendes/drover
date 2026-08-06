import { type FormEvent, useId, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
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
import type { WorkspaceInfo } from '@/shared/herdr';

export interface CreateWorktreeIntent {
  workspaceId: string;
  branch: string;
  path?: string;
  label?: string;
}

export interface OpenWorktreeIntent {
  workspaceId: string;
  path: string;
}

export interface RemoveWorktreeIntent {
  workspaceId: string;
  force: boolean;
}

interface BaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  error?: string;
}

export interface CreateWorktreeDialogProps extends BaseDialogProps {
  sourceWorkspace: WorkspaceInfo;
  onSubmit: (intent: CreateWorktreeIntent) => void;
}

export interface OpenWorktreeDialogProps extends BaseDialogProps {
  sourceWorkspace: WorkspaceInfo;
  onSubmit: (intent: OpenWorktreeIntent) => void;
}

export interface RemoveWorktreeDialogProps extends BaseDialogProps {
  workspace: WorkspaceInfo;
  force?: boolean;
  onConfirm: (intent: RemoveWorktreeIntent) => void;
}

function ErrorMessage({ message }: { message?: string }) {
  return message ? (
    <div className="rounded-base border-2 border-border bg-chart-2 p-3 text-sm" role="alert">
      {message}
    </div>
  ) : null;
}

const optionalValue = (value: string) => value.trim() || undefined;

export function CreateWorktreeDialog({
  sourceWorkspace,
  open,
  onOpenChange,
  onSubmit,
  busy = false,
  error,
}: CreateWorktreeDialogProps) {
  const branchId = useId();
  const pathId = useId();
  const labelId = useId();
  const [branch, setBranch] = useState('');
  const [path, setPath] = useState('');
  const [label, setLabel] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalizedBranch = branch.trim();
    if (!normalizedBranch || busy) {
      return;
    }
    onSubmit({
      workspaceId: sourceWorkspace.workspace_id,
      branch: normalizedBranch,
      path: optionalValue(path),
      label: optionalValue(label),
    });
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create linked worktree</DialogTitle>
          <DialogDescription>
            Create a checkout from {sourceWorkspace.label}. Herdr remains the source of workspace
            and checkout state.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor={branchId}>Branch name</Label>
            <Input
              autoFocus
              id={branchId}
              onChange={(event) => setBranch(event.currentTarget.value)}
              placeholder="feature/navigation"
              required
              value={branch}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={pathId}>Checkout path</Label>
            <Input
              id={pathId}
              onChange={(event) => setPath(event.currentTarget.value)}
              placeholder="Optional; Herdr can choose the path"
              value={path}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={labelId}>Workspace label</Label>
            <Input
              id={labelId}
              onChange={(event) => setLabel(event.currentTarget.value)}
              placeholder="Optional"
              value={label}
            />
          </div>
          <ErrorMessage message={error} />
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="neutral"
            >
              Cancel
            </Button>
            <Button disabled={busy || !branch.trim()} type="submit">
              {busy ? 'Creating worktree' : 'Create worktree'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OpenWorktreeDialog({
  sourceWorkspace,
  open,
  onOpenChange,
  onSubmit,
  busy = false,
  error,
}: OpenWorktreeDialogProps) {
  const pathId = useId();
  const [path, setPath] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalizedPath = path.trim();
    if (!normalizedPath || busy) {
      return;
    }
    onSubmit({ workspaceId: sourceWorkspace.workspace_id, path: normalizedPath });
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open existing worktree</DialogTitle>
          <DialogDescription>
            Open an existing checkout in the {sourceWorkspace.label} repository group.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor={pathId}>Existing checkout path</Label>
            <Input
              autoFocus
              id={pathId}
              onChange={(event) => setPath(event.currentTarget.value)}
              placeholder="/path/to/checkout"
              required
              value={path}
            />
          </div>
          <ErrorMessage message={error} />
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="neutral"
            >
              Cancel
            </Button>
            <Button disabled={busy || !path.trim()} type="submit">
              {busy ? 'Opening worktree' : 'Open worktree'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveWorktreeDialog({
  workspace,
  open,
  onOpenChange,
  onConfirm,
  busy = false,
  error,
  force = false,
}: RemoveWorktreeDialogProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete worktree checkout?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                This removes {workspace.label} at{' '}
                <strong>{workspace.worktree?.checkout_path || 'its checkout path'}</strong>.
              </p>
              <p>The Git branch will not be deleted.</p>
              {force ? (
                <p className="rounded-base border-2 border-border bg-chart-2 p-3">
                  Force removal is enabled because the checkout may contain local changes.
                </p>
              ) : null}
              <ErrorMessage message={error} />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-chart-2"
            disabled={busy}
            onClick={() => onConfirm({ workspaceId: workspace.workspace_id, force })}
          >
            {busy ? 'Deleting checkout' : 'Delete checkout'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
