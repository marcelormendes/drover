import {
  Blocks,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CloudCog,
  Command,
  Download,
  FolderGit2,
  GitBranch,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  MoreHorizontal,
  PanelBottom,
  PanelRight,
  Pencil,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  Rocket,
  Settings,
  SlidersHorizontal,
  SquareTerminal,
  Trash2,
  Wifi,
} from 'lucide-react';
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toaster } from '@/components/ui/sonner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AgentSidebar } from '@/renderer/agents/AgentSidebar';
import {
  ChatPanel,
  type ChatSessionState,
  type ChatSessionUpdate,
  createChatSessionState,
} from '@/renderer/chat/ChatPanel';
import { ShortcutHelpDialog } from '@/renderer/help/ShortcutHelpDialog';
import { WhatsNewDialog } from '@/renderer/help/WhatsNewDialog';
import { Navigator, planTabMove, planWorkspaceMove, ReorderControls } from '@/renderer/navigation';
import { agentNotifications } from '@/renderer/notifications/agent-notifications';
import { deliverSystemNotification } from '@/renderer/notifications/system-notification';
import { PaneControls, PaneDetails, type PaneMoveIntent, SplitHandles } from '@/renderer/panes';
import {
  type InstalledPluginViewModel,
  type InstallPluginIntent,
  type PluginActionViewModel,
  PluginCenter,
} from '@/renderer/plugins/PluginCenter';
import { buildPluginInstallCommand } from '@/renderer/plugins/plugin-install';
import {
  isPluginActionCompatible,
  pluginPlatformFromNavigator,
} from '@/renderer/plugins/plugin-platform';
import { MobileSwitcher, type MobileSwitcherSection } from '@/renderer/responsive';
import { SettingsDialog } from '@/renderer/settings/SettingsDialog';
import { StatusDot } from '@/renderer/status';
import { TerminalPanel } from '@/renderer/terminal/TerminalPanel';
import {
  CreateWorktreeDialog,
  OpenWorktreeDialog,
  RemoveWorktreeDialog,
  WorktreeSpaces,
} from '@/renderer/worktrees';
import {
  AGENT_KINDS,
  type AgentKind,
  type AgentManifestInfo,
  type DesktopAction,
  type DesktopUpdateInfo,
  type EngineUpdateResult,
  type HerdrCommand,
  type HerdrQueryResult,
  INTEGRATION_TARGETS,
  type InstalledPluginInfo,
  type PluginActionInfo,
} from '@/shared/desktop-api';
import type { HerdrEventConnectionState } from '@/shared/events';
import type { EngineBootstrap, PaneInfo, PaneLayoutSnapshot, WorkspaceInfo } from '@/shared/herdr';
import {
  DEFAULT_DESKTOP_PREFERENCES,
  DEFAULT_REMOTE_ENGINE_PREFERENCE,
  type DesktopPreferences,
} from '@/shared/preferences';
import type { RemoteEngineStatus, RemoteEngineTarget } from '@/shared/remote-engine';
import packageMetadata from '../../package.json';

const INSTALL_URL = 'https://github.com/herdrdev/herdr#installation';
const currentPluginPlatform = pluginPlatformFromNavigator(navigator.platform, navigator.userAgent);

function AppMark() {
  return (
    <div
      className="grid size-8 shrink-0 place-items-center rounded-base border-2 border-border bg-main text-main-foreground shadow-none"
      data-slot="app-mark"
    >
      <Command aria-hidden="true" className="size-4 stroke-[3]" />
    </div>
  );
}

function worktreeCreationSource(
  workspaces: readonly WorkspaceInfo[],
  workspace: WorkspaceInfo,
): WorkspaceInfo {
  const worktree = workspace.worktree;
  if (!worktree?.is_linked_worktree) {
    return workspace;
  }

  return (
    workspaces.find(
      (candidate) =>
        candidate.worktree?.repo_key === worktree.repo_key &&
        !candidate.worktree.is_linked_worktree,
    ) || workspace
  );
}

function WindowChrome({
  onRefresh,
  onPlugins,
  onSettings,
  busy,
}: {
  onRefresh?: () => void;
  onPlugins?: () => void;
  onSettings?: () => void;
  busy?: boolean;
}) {
  return (
    <header className="app-drag flex h-12 shrink-0 items-center border-b-2 border-border bg-secondary-background pl-24 pr-3">
      <div className="flex min-w-0 items-center gap-3">
        <AppMark />
        <span className="truncate text-sm font-heading tracking-[0.12em]">HERDR</span>
        <span className="hidden truncate font-mono text-[10px] uppercase tracking-[0.18em] opacity-50 lg:inline">
          The herd, from a client that isn't there
        </span>
      </div>
      <div className="app-no-drag ml-auto flex items-center gap-2">
        {onPlugins ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Plugins"
                className="size-8"
                disabled={busy}
                onClick={onPlugins}
                size="icon"
                variant="neutral"
              >
                <Puzzle aria-hidden="true" className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Herdr plugins</TooltipContent>
          </Tooltip>
        ) : null}
        {onRefresh ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Refresh session"
                className="size-8"
                disabled={busy}
                onClick={onRefresh}
                size="icon"
                variant="neutral"
              >
                <RefreshCw aria-hidden="true" className={cn('size-4', busy && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh Herdr snapshot</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Settings"
              className="size-8"
              disabled={!onSettings}
              onClick={onSettings}
              size="icon"
              variant="neutral"
            >
              <Settings aria-hidden="true" className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-full flex-col bg-background">
      <WindowChrome />
      <main className="grid flex-1 place-items-center p-8">
        <Card className="w-full max-w-md bg-secondary-background">
          <CardContent className="flex items-center gap-4 py-1">
            <div className="grid size-12 place-items-center rounded-base border-2 border-border bg-main text-main-foreground shadow-shadow">
              <RefreshCw aria-hidden="true" className="size-5 animate-spin" />
            </div>
            <div>
              <h1 className="text-lg">Connecting to Herdr</h1>
              <p className="mt-1 text-sm">Reading the engine status and live session snapshot.</p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

interface OnboardingScreenProps {
  result: Exclude<EngineBootstrap, { state: 'connected' }>;
  busy: boolean;
  onRetry: () => void;
  onStart: () => void;
  onSettings: () => void;
  onEngineUpdate: () => Promise<EngineUpdateResult>;
  onCheckDesktopUpdate: () => Promise<void>;
}

function OnboardingScreen({
  result,
  busy,
  onRetry,
  onStart,
  onSettings,
  onEngineUpdate,
  onCheckDesktopUpdate,
}: OnboardingScreenProps) {
  const missing = result.state === 'missing';
  const stopped = result.state === 'stopped';
  const incompatible = result.state === 'incompatible';
  const title = missing
    ? 'Herdr engine not found'
    : stopped
      ? 'Herdr server is stopped'
      : incompatible
        ? 'Herdr versions do not match'
        : 'Herdr could not be reached';
  const message =
    result.state === 'missing' || result.state === 'error'
      ? result.message
      : stopped
        ? 'The Herdr CLI is installed. Start its headless server to open your session here.'
        : 'The running Herdr server uses a different protocol. Restart it with your current Herdr CLI.';

  return (
    <div className="flex h-full flex-col bg-background">
      <WindowChrome onSettings={onSettings} />
      <main className="relative grid flex-1 place-items-center overflow-hidden p-8">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-30 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:32px_32px]"
        />
        <Card className="relative w-full max-w-2xl bg-secondary-background">
          <CardHeader className="border-b-2 border-border">
            <div className="mb-5 flex size-14 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground shadow-shadow">
              {missing ? <CloudCog aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
            </div>
            <CardTitle>
              <h1 className="text-3xl">{title}</h1>
            </CardTitle>
            <p className="max-w-xl pt-2 text-base leading-7">{message}</p>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['01', 'Engine', missing ? 'Install Herdr' : 'CLI detected'],
                ['02', 'Server', stopped ? 'Ready to start' : 'Check version'],
                ['03', 'Desktop', 'Connect automatically'],
              ].map(([number, label, detail]) => (
                <div className="rounded-base border-2 border-border bg-background p-3" key={number}>
                  <span className="text-xs font-heading">
                    {number} / {label}
                  </span>
                  <p className="mt-2 text-sm">{detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              {missing ? (
                <Button onClick={() => window.herdr.openExternal(INSTALL_URL)}>
                  Open install guide
                </Button>
              ) : null}
              {stopped ? (
                <Button disabled={busy} onClick={onStart}>
                  <Play aria-hidden="true" />
                  Start Herdr
                </Button>
              ) : null}
              <Button disabled={busy} onClick={onRetry} variant="neutral">
                <RefreshCw aria-hidden="true" className={cn(busy && 'animate-spin')} />
                Check again
              </Button>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-base border-2 border-border bg-background p-3 font-mono text-[11px]">
              <div className="min-w-0">
                {'status' in result ? (
                  <>
                    <p className="truncate opacity-50">
                      v{result.status.client.version} · protocol {result.status.client.protocol}
                    </p>
                    <p className="truncate opacity-50">Desktop v{packageMetadata.version}</p>
                  </>
                ) : (
                  <p className="truncate opacity-50">Desktop v{packageMetadata.version}</p>
                )}
              </div>
              <UpdateButtons
                busy={busy}
                onCheckDesktopUpdate={onCheckDesktopUpdate}
                onEngineUpdate={onEngineUpdate}
              />
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function CreateWorkspaceDialog({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (cwd?: string, label?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cwd, setCwd] = useState('');
  const [label, setLabel] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onCreate(cwd.trim() || undefined, label.trim() || undefined);
    setOpen(false);
    setCwd('');
    setLabel('');
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button className="w-full" variant="neutral">
          <Plus aria-hidden="true" /> New workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a Herdr workspace</DialogTitle>
          <DialogDescription>
            Herdr owns the workspace and terminal. This desktop app sends the request.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="workspace-cwd">Working directory</Label>
            <Input
              autoFocus
              id="workspace-cwd"
              onChange={(event) => setCwd(event.target.value)}
              placeholder="/path/to/project"
              value={cwd}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace-label">Workspace label</Label>
            <Input
              id="workspace-label"
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional"
              value={label}
            />
          </div>
          <DialogFooter>
            <Button disabled={busy} type="submit">
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateTabDialog({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (label?: string, cwd?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [cwd, setCwd] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onCreate(label.trim() || undefined, cwd.trim() || undefined);
    setOpen(false);
    setLabel('');
    setCwd('');
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button aria-label="New tab" className="size-8" size="icon" variant="neutral">
          <Plus aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a Herdr tab</DialogTitle>
          <DialogDescription>
            Add another engine-owned terminal tab to this workspace.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="tab-label">Tab label</Label>
            <Input
              autoFocus
              id="tab-label"
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Optional"
              value={label}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tab-cwd">Working directory</Label>
            <Input
              id="tab-cwd"
              onChange={(event) => setCwd(event.target.value)}
              placeholder="Inherit workspace"
              value={cwd}
            />
          </div>
          <DialogFooter>
            <Button disabled={busy} type="submit">
              Create tab
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface NamedResourceTarget {
  kind: 'workspace' | 'tab' | 'pane';
  id: string;
  label: string;
}

function RenameResourceDialog({
  target,
  onOpenChange,
  onSave,
}: {
  target: NamedResourceTarget | null;
  onOpenChange: (open: boolean) => void;
  onSave: (target: NamedResourceTarget, label: string) => void;
}) {
  const [label, setLabel] = useState(target?.label || '');

  useEffect(() => setLabel(target?.label || ''), [target]);
  if (!target) {
    return null;
  }

  const resourceName = `${target.kind[0].toUpperCase()}${target.kind.slice(1)}`;
  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {target.kind}</DialogTitle>
          <DialogDescription>The new name is stored by the Herdr engine.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            const nextLabel = label.trim();
            if (nextLabel) {
              onSave(target, nextLabel);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="resource-name">{resourceName} name</Label>
            <Input
              autoFocus
              id="resource-name"
              onChange={(event) => setLabel(event.target.value)}
              value={label}
            />
          </div>
          <DialogFooter>
            <Button disabled={!label.trim()} type="submit">
              Save {target.kind} name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CloseResourceDialog({
  target,
  onOpenChange,
  onConfirm,
}: {
  target: NamedResourceTarget | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (target: NamedResourceTarget) => void;
}) {
  if (!target) {
    return null;
  }

  return (
    <AlertDialog onOpenChange={onOpenChange} open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close {target.kind}?</AlertDialogTitle>
          <AlertDialogDescription>
            Herdr will close “{target.label}” and its live terminal resources. This cannot be undone
            from the desktop app.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(target)}>
            Close {target.kind}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function StartAgentDialog({
  pane,
  busy,
  onStart,
}: {
  pane?: PaneInfo;
  busy: boolean;
  onStart: (
    paneId: string,
    name: string,
    kind: AgentKind,
    args: string[],
    timeoutMs: number,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AgentKind>('codex');
  const [args, setArgs] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState('30');
  const startupTimeout = Number(timeoutSeconds);
  const validTimeout =
    Number.isInteger(startupTimeout) && startupTimeout > 3 && startupTimeout <= 300;
  const parsedArgs =
    args.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g)?.map((argument) => {
      const quoted =
        (argument.startsWith('"') && argument.endsWith('"')) ||
        (argument.startsWith("'") && argument.endsWith("'"));
      return quoted ? argument.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : argument;
    }) || [];

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button className="w-full" disabled={!pane} variant="neutral">
          <Rocket aria-hidden="true" /> Launch agent
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start an agent</DialogTitle>
          <DialogDescription>
            Herdr starts the supported agent inside {pane?.pane_id || 'the focused pane'} and waits
            until it is interactive.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pane || !/^[a-z][a-z0-9_-]{0,31}$/.test(name)) {
              return;
            }
            if (!validTimeout) {
              return;
            }
            onStart(pane.pane_id, name, kind, parsedArgs, startupTimeout * 1_000);
            setOpen(false);
            setName('');
            setArgs('');
            setTimeoutSeconds('30');
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="agent-name">Agent name</Label>
            <Input
              autoFocus
              id="agent-name"
              onChange={(event) => setName(event.target.value)}
              pattern="[a-z][a-z0-9_\-]{0,31}"
              placeholder="reviewer"
              value={name}
            />
            <p className="text-xs opacity-70">
              Lowercase letters, numbers, hyphens, and underscores.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-kind">Agent kind</Label>
            <Select onValueChange={(value) => setKind(value as AgentKind)} value={kind}>
              <SelectTrigger aria-label="Agent kind" id="agent-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_KINDS.map((agentKind) => (
                  <SelectItem key={agentKind} value={agentKind}>
                    {agentKind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-arguments">Agent arguments</Label>
            <Input
              id="agent-arguments"
              onChange={(event) => setArgs(event.target.value)}
              placeholder="--model gpt-5"
              value={args}
            />
            <p className="text-xs opacity-70">
              Optional native arguments, with quoted values supported.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-timeout">Startup timeout in seconds</Label>
            <Input
              id="agent-timeout"
              inputMode="numeric"
              max={300}
              min={4}
              onChange={(event) => setTimeoutSeconds(event.target.value)}
              type="number"
              value={timeoutSeconds}
            />
            <p className="text-xs opacity-70">Herdr accepts 4–300 seconds.</p>
          </div>
          <DialogFooter>
            <Button
              disabled={busy || !validTimeout || !/^[a-z][a-z0-9_-]{0,31}$/.test(name)}
              type="submit"
            >
              Start agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaneStage({
  pane,
  panes,
  layout,
  busy,
  onFocus,
  onSplit,
  onZoom,
  onRename,
  onOpenControls,
  onClose,
  onSetSplitRatio,
  onPrompt,
  onSendInput,
  readOutput,
  chatSessions,
  onChatSessionChange,
  showPaneLabels,
}: {
  pane?: PaneInfo;
  panes: PaneInfo[];
  layout?: PaneLayoutSnapshot;
  busy: boolean;
  onFocus: (paneId: string) => void;
  onSplit: (paneId: string, direction: 'right' | 'down') => void;
  onZoom: (paneId: string) => void;
  onRename: (pane: PaneInfo) => void;
  onOpenControls: (pane: PaneInfo) => void;
  onClose: (pane: PaneInfo) => void;
  onSetSplitRatio: (tabId: string, path: boolean[], ratio: number) => void;
  onPrompt: (target: string, text: string) => void | Promise<void>;
  onSendInput: (paneId: string, input: { text?: string; keys?: string[] }) => void | Promise<void>;
  readOutput: (paneId: string) => Promise<Extract<HerdrQueryResult, { type: 'pane-output' }>>;
  chatSessions: Readonly<Record<string, ChatSessionState>>;
  onChatSessionChange: (paneId: string, update: ChatSessionUpdate) => void;
  showPaneLabels: boolean;
}) {
  const [viewByPane, setViewByPane] = useState<Record<string, 'chat' | 'terminal'>>({});
  if (!pane) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-8">
        <p>No pane is available in this tab.</p>
      </div>
    );
  }

  const area = layout?.area;
  const paneRects = new Map(layout?.panes.map((item) => [item.pane_id, item.rect]) || []);
  const styleFor = (item: PaneInfo): CSSProperties => {
    if (layout?.zoomed) {
      return { inset: 0 };
    }
    const rect = paneRects.get(item.pane_id);
    if (!area || !rect || area.width <= 0 || area.height <= 0) {
      return { inset: 0 };
    }
    return {
      left: `${((rect.x - area.x) / area.width) * 100}%`,
      top: `${((rect.y - area.y) / area.height) * 100}%`,
      width: `${(rect.width / area.width) * 100}%`,
      height: `${(rect.height / area.height) * 100}%`,
    };
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden p-1">
      {panes.map((item) => {
        const focused = item.pane_id === pane.pane_id;
        const hiddenByZoom = Boolean(layout?.zoomed && !focused);
        const hasAgent = Boolean(item.agent || item.display_agent);
        const view = hasAgent ? viewByPane[item.pane_id] || 'chat' : 'terminal';
        return (
          <div
            aria-hidden={hiddenByZoom || undefined}
            className={cn('absolute p-1', hiddenByZoom && 'hidden')}
            key={item.pane_id}
            style={styleFor(item)}
          >
            <Card
              className={cn(
                'h-full gap-0 overflow-hidden bg-secondary-background py-0 shadow-none',
                focused && 'border-main shadow-shadow',
              )}
              onMouseDown={() => !focused && onFocus(item.pane_id)}
            >
              <div className="flex h-10 shrink-0 items-center gap-2 border-b-2 border-border bg-secondary-background px-3">
                {view === 'chat' ? (
                  <MessageSquare aria-hidden="true" className="size-4 shrink-0 opacity-60" />
                ) : (
                  <SquareTerminal aria-hidden="true" className="size-4 shrink-0 opacity-60" />
                )}
                {showPaneLabels ? (
                  <span
                    className={cn(
                      'min-w-0 truncate font-mono text-xs',
                      focused ? 'text-main' : 'opacity-60',
                    )}
                  >
                    {item.label || item.title || item.pane_id}
                  </span>
                ) : null}
                {focused ? (
                  <div className="ml-auto flex shrink-0 gap-2">
                    {hasAgent ? (
                      <fieldset
                        aria-label="Pane view"
                        className="m-0 flex min-w-0 overflow-hidden rounded-base border-2 border-border bg-secondary-background p-0"
                      >
                        <Button
                          aria-label="Chat view"
                          aria-pressed={view === 'chat'}
                          className={cn(
                            'h-7 rounded-none border-0 px-2 shadow-none hover:translate-x-0 hover:translate-y-0',
                            view === 'chat' && 'bg-main text-main-foreground',
                          )}
                          onClick={() =>
                            setViewByPane((current) => ({
                              ...current,
                              [item.pane_id]: 'chat',
                            }))
                          }
                          size="sm"
                          variant="neutral"
                        >
                          <MessageSquare aria-hidden="true" />
                          <span className="hidden xl:inline">Chat</span>
                        </Button>
                        <Button
                          aria-label="Terminal view"
                          aria-pressed={view === 'terminal'}
                          className={cn(
                            'h-7 rounded-none border-0 border-l-2 px-2 shadow-none hover:translate-x-0 hover:translate-y-0',
                            view === 'terminal' && 'bg-main text-main-foreground',
                          )}
                          onClick={() =>
                            setViewByPane((current) => ({
                              ...current,
                              [item.pane_id]: 'terminal',
                            }))
                          }
                          size="sm"
                          variant="neutral"
                        >
                          <SquareTerminal aria-hidden="true" />
                          <span className="hidden xl:inline">Terminal</span>
                        </Button>
                      </fieldset>
                    ) : null}
                    <Button
                      aria-label={layout?.zoomed ? 'Exit pane zoom' : 'Zoom pane'}
                      className="size-7"
                      disabled={busy}
                      onClick={() => onZoom(item.pane_id)}
                      size="icon"
                      variant="neutral"
                    >
                      {layout?.zoomed ? (
                        <Minimize2 aria-hidden="true" />
                      ) : (
                        <Maximize2 aria-hidden="true" />
                      )}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          aria-label="Pane actions"
                          className="size-7"
                          disabled={busy}
                          size="icon"
                          variant="neutral"
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onOpenControls(item)}>
                          <SlidersHorizontal aria-hidden="true" /> More pane controls
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onRename(item)}>
                          <Pencil aria-hidden="true" /> Rename pane
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onClose(item)}>
                          <Trash2 aria-hidden="true" /> Close pane
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      aria-label="Split pane right"
                      className="size-7"
                      disabled={busy}
                      onClick={() => onSplit(item.pane_id, 'right')}
                      size="icon"
                      variant="neutral"
                    >
                      <PanelRight aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label="Split pane down"
                      className="size-7"
                      disabled={busy}
                      onClick={() => onSplit(item.pane_id, 'down')}
                      size="icon"
                      variant="neutral"
                    >
                      <PanelBottom aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </div>
              {view === 'chat' ? (
                <ChatPanel
                  onOpenTerminal={() =>
                    setViewByPane((current) => ({
                      ...current,
                      [item.pane_id]: 'terminal',
                    }))
                  }
                  onPrompt={onPrompt}
                  onSendInput={onSendInput}
                  onSessionChange={(update) => onChatSessionChange(item.pane_id, update)}
                  pane={item}
                  readOutput={readOutput}
                  session={chatSessions[item.pane_id]}
                  stageImages={(images) => window.herdr.stageChatImages(images)}
                />
              ) : (
                <TerminalPanel
                  onOpenExternal={(url) => void window.herdr.openExternal(url)}
                  onScrollRequest={(request) =>
                    void window.herdr.terminal.scroll({
                      paneId: request.paneId,
                      direction: request.direction,
                      lines:
                        request.unit === 'page'
                          ? (item.scroll?.viewport_rows || 24) * request.amount
                          : request.amount,
                      source: request.unit === 'page' ? 'page_key' : 'wheel',
                    })
                  }
                  pane={item}
                />
              )}
            </Card>
          </div>
        );
      })}
      {layout && !layout.zoomed ? (
        <SplitHandles
          disabled={busy}
          layout={layout}
          onRatioChange={({ splitId, ratio }) => {
            const encodedPath = splitId.split('_').at(-1);
            const path =
              encodedPath === 'root'
                ? []
                : encodedPath && /^[01]+$/.test(encodedPath)
                  ? [...encodedPath].map((part) => part === '1')
                  : null;
            if (path) {
              onSetSplitRatio(layout.tab_id, path, ratio);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function EngineUpdateButton({ busy, onUpdate }: { busy: boolean; onUpdate: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="Update Herdr engine"
          className="size-6"
          disabled={busy}
          onClick={onUpdate}
          size="icon"
          variant="neutral"
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Update Herdr engine</TooltipContent>
    </Tooltip>
  );
}

function DesktopUpdateButton({ busy, onUpdate }: { busy: boolean; onUpdate: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="Update Herdr Desktop"
          className="size-6"
          disabled={busy}
          onClick={onUpdate}
          size="icon"
          variant="neutral"
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Download aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Update Herdr Desktop</TooltipContent>
    </Tooltip>
  );
}

function UpdateButtons({
  onEngineUpdate,
  onCheckDesktopUpdate,
  busy,
}: {
  onEngineUpdate: () => Promise<EngineUpdateResult>;
  onCheckDesktopUpdate: () => Promise<void>;
  busy: boolean;
}) {
  const [engineUpdating, setEngineUpdating] = useState(false);
  const [desktopChecking, setDesktopChecking] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <EngineUpdateButton
        busy={engineUpdating || busy}
        onUpdate={() => {
          setEngineUpdating(true);
          void onEngineUpdate().finally(() => setEngineUpdating(false));
        }}
      />
      <DesktopUpdateButton
        busy={desktopChecking || busy}
        onUpdate={() => {
          setDesktopChecking(true);
          void onCheckDesktopUpdate().finally(() => setDesktopChecking(false));
        }}
      />
    </div>
  );
}

function DesktopUpdateDialog({
  info,
  onClose,
}: {
  info: DesktopUpdateInfo | null;
  onClose: () => void;
}) {
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={Boolean(info?.updateAvailable)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Herdr Desktop update available</AlertDialogTitle>
          <AlertDialogDescription>
            A newer version of Herdr Desktop is ready: v{info?.currentVersion} → v
            {info?.latestVersion}. Open the release page to download it and replace this app.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const url = info?.releaseUrl;
              if (url) {
                void window.herdr.openExternal(url);
              }
              onClose();
            }}
          >
            Download
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConnectedShell({
  result,
  onRefresh,
  onCommand,
  onNavigator,
  onPlugins,
  onSettings,
  onShortcuts,
  onEngineUpdate,
  onCheckDesktopUpdate,
  preferences,
  onPreferencesChange,
  connectionState,
  busy,
}: {
  result: Extract<EngineBootstrap, { state: 'connected' }>;
  onRefresh: () => void;
  onCommand: (command: HerdrCommand) => Promise<EngineBootstrap>;
  onNavigator: () => void;
  onPlugins: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onEngineUpdate: () => Promise<EngineUpdateResult>;
  onCheckDesktopUpdate: () => Promise<void>;
  preferences: DesktopPreferences;
  onPreferencesChange: (preferences: DesktopPreferences) => void;
  connectionState: HerdrEventConnectionState;
  busy: boolean;
}) {
  const { snapshot, status } = result;
  const runChatCommand = useCallback(
    async (command: HerdrCommand): Promise<void> => {
      const next = await onCommand(command);
      if (next.state !== 'connected') {
        throw new Error(
          next.state === 'error' || next.state === 'missing'
            ? next.message
            : 'Herdr command failed.',
        );
      }
    },
    [onCommand],
  );
  const [workspaceId, setWorkspaceId] = useState(
    snapshot.focused_workspace_id || snapshot.workspaces[0]?.workspace_id,
  );
  const workspace =
    snapshot.workspaces.find((item) => item.workspace_id === workspaceId) || snapshot.workspaces[0];
  const workspaceTabs = useMemo(
    () => snapshot.tabs.filter((tab) => tab.workspace_id === workspace?.workspace_id),
    [snapshot.tabs, workspace?.workspace_id],
  );
  const [tabByWorkspace, setTabByWorkspace] = useState<Record<string, string>>({});
  const activeTabId =
    (workspace && tabByWorkspace[workspace.workspace_id]) ||
    workspace?.active_tab_id ||
    workspaceTabs[0]?.tab_id;
  const activeTab = workspaceTabs.find((item) => item.tab_id === activeTabId) || workspaceTabs[0];
  const panes = snapshot.panes.filter((pane) => pane.tab_id === activeTabId);
  const pane = panes.find((item) => item.pane_id === snapshot.focused_pane_id) || panes[0];
  const layout = snapshot.layouts.find((item) => item.tab_id === activeTabId);
  const agents = snapshot.agents;
  const [renameTarget, setRenameTarget] = useState<NamedResourceTarget | null>(null);
  const [closeTarget, setCloseTarget] = useState<NamedResourceTarget | null>(null);
  const [createWorktreeSource, setCreateWorktreeSource] = useState<WorkspaceInfo | null>(null);
  const [openWorktreeSource, setOpenWorktreeSource] = useState<WorkspaceInfo | null>(null);
  const [removeWorktreeTarget, setRemoveWorktreeTarget] = useState<WorkspaceInfo | null>(null);
  const [paneControlsTarget, setPaneControlsTarget] = useState<PaneInfo | null>(null);
  const [mobileSwitcherOpen, setMobileSwitcherOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<MobileSwitcherSection>('agents');
  const [chatSessions, setChatSessions] = useState<Record<string, ChatSessionState>>({});
  const updateChatSession = useCallback((paneId: string, update: ChatSessionUpdate) => {
    setChatSessions((current) => {
      const previous = current[paneId] || createChatSessionState();
      const next = update(previous);
      return next === previous ? current : { ...current, [paneId]: next };
    });
  }, []);
  const readPaneOutput = useCallback(async (paneId: string) => {
    const output = await window.herdr.query({
      type: 'read-pane-output',
      paneId,
      lines: 500,
      ansi: true,
    });
    if (output.type !== 'pane-output') {
      throw new Error('Herdr returned an unexpected pane output response.');
    }
    return output;
  }, []);
  const controlsPane = paneControlsTarget
    ? snapshot.panes.find((item) => item.pane_id === paneControlsTarget.pane_id) ||
      paneControlsTarget
    : undefined;

  useEffect(() => {
    if (snapshot.focused_workspace_id) {
      setWorkspaceId(snapshot.focused_workspace_id);
    }
    if (snapshot.focused_workspace_id && snapshot.focused_tab_id) {
      setTabByWorkspace((current) => ({
        ...current,
        [snapshot.focused_workspace_id as string]: snapshot.focused_tab_id as string,
      }));
    }
  }, [snapshot.focused_tab_id, snapshot.focused_workspace_id]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || !/^[1-9]$/.test(event.key)) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches('input, textarea, select'))
      ) {
        return;
      }
      const targetWorkspace = snapshot.workspaces[Number(event.key) - 1];
      if (!targetWorkspace || targetWorkspace.workspace_id === workspaceId) {
        return;
      }
      event.preventDefault();
      setWorkspaceId(targetWorkspace.workspace_id);
      onCommand({ type: 'focus-workspace', workspaceId: targetWorkspace.workspace_id });
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [onCommand, snapshot.workspaces, workspaceId]);

  if (!workspace) {
    return (
      <div className="flex h-full flex-col bg-background">
        <WindowChrome busy={busy} onRefresh={onRefresh} onSettings={onSettings} />
        <main className="grid flex-1 place-items-center p-8">
          <Card className="max-w-md bg-secondary-background text-center">
            <CardHeader>
              <CardTitle>No workspaces yet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p>Create the first workspace here. Herdr will own its terminal and session state.</p>
              <CreateWorkspaceDialog
                busy={busy}
                onCreate={(cwd, label) => onCommand({ type: 'create-workspace', cwd, label })}
              />
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <WindowChrome
        busy={busy}
        onPlugins={onPlugins}
        onRefresh={onRefresh}
        onSettings={onSettings}
      />
      <div
        className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[var(--spaces-width)_minmax(0,1fr)]"
        data-slot="session-shell"
        style={
          {
            '--spaces-width': preferences.spacesCollapsed ? '64px' : '280px',
          } as CSSProperties
        }
      >
        <aside className="hidden min-h-0 flex-col border-r-2 border-border bg-secondary-background xl:flex">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b-2 border-border px-3">
            {preferences.spacesCollapsed ? (
              <Blocks aria-hidden="true" className="size-4 shrink-0 opacity-60" />
            ) : null}
            {!preferences.spacesCollapsed ? (
              <>
                <span className="min-w-0 flex-1 truncate font-mono text-xs tracking-[0.08em] opacity-60">
                  spaces
                </span>
                <span className="ml-auto font-mono text-xs opacity-60">
                  {snapshot.workspaces.length}
                </span>
                <ReorderControls
                  canMoveDown={snapshot.workspaces.at(-1)?.workspace_id !== workspace.workspace_id}
                  canMoveUp={snapshot.workspaces[0]?.workspace_id !== workspace.workspace_id}
                  label={workspace.label}
                  onMove={(direction) => {
                    const intent = planWorkspaceMove(
                      snapshot.workspaces,
                      workspace.workspace_id,
                      direction,
                    );
                    if (intent) {
                      onCommand({
                        type: 'move-workspace',
                        workspaceId: intent.workspaceId,
                        insertIndex: intent.insertIndex,
                      });
                    }
                  }}
                />
              </>
            ) : null}
            <Button
              aria-label={
                preferences.spacesCollapsed
                  ? 'Expand workspace sidebar'
                  : 'Collapse workspace sidebar'
              }
              className={cn('size-7', preferences.spacesCollapsed && 'ml-auto')}
              onClick={() =>
                onPreferencesChange({
                  ...preferences,
                  spacesCollapsed: !preferences.spacesCollapsed,
                })
              }
              size="icon"
              variant="neutral"
            >
              {preferences.spacesCollapsed ? (
                <ChevronRight aria-hidden="true" />
              ) : (
                <ChevronLeft aria-hidden="true" />
              )}
            </Button>
          </div>
          {!preferences.spacesCollapsed ? (
            // Spaces take only the room they need so agents keep the rest.
            <div className="max-h-[45%] shrink-0 overflow-y-auto">
              <div className="p-2">
                <WorktreeSpaces
                  defaultExpandedRepoKeys={snapshot.workspaces.flatMap((item) =>
                    item.worktree ? [item.worktree.repo_key] : [],
                  )}
                  onCreateWorktree={setCreateWorktreeSource}
                  onFocusWorkspace={(targetWorkspaceId) => {
                    setWorkspaceId(targetWorkspaceId);
                    onCommand({ type: 'focus-workspace', workspaceId: targetWorkspaceId });
                  }}
                  onOpenWorktree={setOpenWorktreeSource}
                  onRemoveWorktree={setRemoveWorktreeTarget}
                  workspaces={snapshot.workspaces}
                />
              </div>
            </div>
          ) : null}
          {!preferences.spacesCollapsed ? (
            <div className="shrink-0 p-3 pt-2">
              <CreateWorkspaceDialog
                busy={busy}
                onCreate={(cwd, label) => onCommand({ type: 'create-workspace', cwd, label })}
              />
            </div>
          ) : null}

          <div
            className={cn(
              'flex min-h-0 flex-col border-t-2 border-border',
              !preferences.spacesCollapsed && !preferences.agentsCollapsed && 'flex-1',
            )}
            data-slot="agents-section"
          >
            <div className="flex h-11 shrink-0 items-center gap-2 px-3">
              <Bot aria-hidden="true" className="size-4 shrink-0 opacity-60" />
              {!preferences.spacesCollapsed ? (
                <>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs tracking-[0.08em] opacity-60">
                    agents
                  </span>
                  <span className="font-mono text-xs opacity-60">{agents.length}</span>
                  <Button
                    aria-label={
                      preferences.agentsCollapsed
                        ? 'Expand agent sidebar'
                        : 'Collapse agent sidebar'
                    }
                    className="size-7"
                    onClick={() =>
                      onPreferencesChange({
                        ...preferences,
                        agentsCollapsed: !preferences.agentsCollapsed,
                      })
                    }
                    size="icon"
                    variant="neutral"
                  >
                    {preferences.agentsCollapsed ? (
                      <ChevronUp aria-hidden="true" />
                    ) : (
                      <ChevronDown aria-hidden="true" />
                    )}
                  </Button>
                </>
              ) : null}
            </div>
            {!preferences.spacesCollapsed && !preferences.agentsCollapsed ? (
              <>
                <ScrollArea className="min-h-0 flex-1">
                  <AgentSidebar
                    agents={agents}
                    onFocus={(agent) => {
                      setWorkspaceId(agent.workspace_id);
                      setTabByWorkspace((current) => ({
                        ...current,
                        [agent.workspace_id]: agent.tab_id,
                      }));
                      onCommand({ type: 'focus-pane', paneId: agent.pane_id });
                    }}
                    onPrompt={(target, text) => onCommand({ type: 'prompt-agent', target, text })}
                    onRename={(target, name) => onCommand({ type: 'rename-agent', target, name })}
                    onSortChange={(agentSort) => onPreferencesChange({ ...preferences, agentSort })}
                    sort={preferences.agentSort}
                  />
                </ScrollArea>
                <div className="shrink-0 p-3 pt-2">
                  <StartAgentDialog
                    busy={busy}
                    onStart={(paneId, name, kind, args, timeoutMs) =>
                      onCommand({ type: 'start-agent', paneId, name, kind, args, timeoutMs })
                    }
                    pane={pane}
                  />
                </div>
              </>
            ) : null}
          </div>

          {!preferences.spacesCollapsed ? (
            <div className="shrink-0 border-t-2 border-border p-3 font-mono text-[11px]">
              <div className="mb-1 flex items-center gap-2">
                <Wifi aria-hidden="true" className="size-3 opacity-60" /> Engine {connectionState}
                <div className="ml-auto">
                  <UpdateButtons
                    busy={busy}
                    onCheckDesktopUpdate={onCheckDesktopUpdate}
                    onEngineUpdate={onEngineUpdate}
                  />
                </div>
              </div>
              <p className="truncate opacity-50">
                v{status.server.version} · protocol {status.server.protocol}
              </p>
              <p className="truncate opacity-50">Desktop v{packageMetadata.version}</p>
            </div>
          ) : null}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b-2 border-border bg-secondary-background px-4">
            <FolderGit2 aria-hidden="true" className="size-4 shrink-0 opacity-60" />
            <h1 className="min-w-0 max-w-[40%] truncate text-sm font-heading">{workspace.label}</h1>
            <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] opacity-50">
              <GitBranch aria-hidden="true" className="size-3 shrink-0" />
              <span className="truncate">
                {workspace.worktree?.checkout_path || pane?.cwd || 'Herdr workspace'}
              </span>
            </div>
            {status.update.restart_needed || status.server.restart_needed ? (
              <Badge className="hidden sm:inline-flex">RESTART NEEDED</Badge>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Button
                aria-label="Open session switcher"
                className="size-8 xl:hidden"
                onClick={() => setMobileSwitcherOpen(true)}
                size="icon"
                variant="neutral"
              >
                <Blocks aria-hidden="true" />
              </Button>
              <Button
                aria-label="New worktree"
                className="h-8 px-2.5"
                disabled={busy}
                onClick={() =>
                  setCreateWorktreeSource(worktreeCreationSource(snapshot.workspaces, workspace))
                }
                size="sm"
                variant="neutral"
              >
                <GitBranch aria-hidden="true" />
                <span className="hidden sm:inline">New worktree</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="Workspace actions"
                    className="size-8"
                    size="icon"
                    variant="neutral"
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      setRenameTarget({
                        kind: 'workspace',
                        id: workspace.workspace_id,
                        label: workspace.label,
                      })
                    }
                  >
                    <Pencil aria-hidden="true" /> Rename workspace
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() =>
                      setCloseTarget({
                        kind: 'workspace',
                        id: workspace.workspace_id,
                        label: workspace.label,
                      })
                    }
                  >
                    <Trash2 aria-hidden="true" /> Close workspace
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <Tabs
            className="flex min-h-0 flex-1 flex-col"
            onValueChange={(tabId) => {
              setTabByWorkspace((current) => ({
                ...current,
                [workspace.workspace_id]: tabId,
              }));
              onCommand({ type: 'focus-tab', tabId });
            }}
            value={activeTabId}
          >
            <div className="flex h-12 shrink-0 items-center border-b-2 border-border bg-background px-4">
              <TabsList className="h-auto gap-2 bg-transparent p-0">
                {workspaceTabs.map((tab) => (
                  <TabsTrigger className="gap-2" key={tab.tab_id} value={tab.tab_id}>
                    <StatusDot status={tab.agent_status} style={preferences.indicatorStyle} />
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="ml-2 flex shrink-0 items-center gap-1" data-slot="tab-actions">
                <CreateTabDialog
                  busy={busy}
                  onCreate={(label, cwd) =>
                    onCommand({
                      type: 'create-tab',
                      workspaceId: workspace.workspace_id,
                      label,
                      cwd,
                    })
                  }
                />
                {activeTab ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label="Tab actions"
                        className="size-8"
                        size="icon"
                        variant="neutral"
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          setRenameTarget({
                            kind: 'tab',
                            id: activeTab.tab_id,
                            label: activeTab.label,
                          })
                        }
                      >
                        <Pencil aria-hidden="true" /> Rename tab
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() =>
                          setCloseTarget({
                            kind: 'tab',
                            id: activeTab.tab_id,
                            label: activeTab.label,
                          })
                        }
                      >
                        <Trash2 aria-hidden="true" /> Close tab
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {activeTab ? (
                  <ReorderControls
                    canMoveDown={workspaceTabs.at(-1)?.tab_id !== activeTab.tab_id}
                    canMoveUp={workspaceTabs[0]?.tab_id !== activeTab.tab_id}
                    label={activeTab.label}
                    onMove={(direction) => {
                      const intent = planTabMove(
                        snapshot.tabs,
                        workspace.workspace_id,
                        activeTab.tab_id,
                        direction,
                      );
                      if (intent) {
                        onCommand({
                          type: 'move-tab',
                          tabId: intent.tabId,
                          insertIndex: intent.insertIndex,
                        });
                      }
                    }}
                  />
                ) : null}
              </div>
            </div>
            <PaneStage
              busy={busy}
              chatSessions={chatSessions}
              layout={layout}
              onChatSessionChange={updateChatSession}
              onClose={(item) =>
                setCloseTarget({
                  kind: 'pane',
                  id: item.pane_id,
                  label: item.label || item.title || item.pane_id,
                })
              }
              onFocus={(paneId) => onCommand({ type: 'focus-pane', paneId })}
              onRename={(item) =>
                setRenameTarget({
                  kind: 'pane',
                  id: item.pane_id,
                  label: item.label || item.title || item.pane_id,
                })
              }
              onOpenControls={setPaneControlsTarget}
              onSplit={(paneId, direction) => onCommand({ type: 'split-pane', paneId, direction })}
              onSetSplitRatio={(tabId, path, ratio) =>
                onCommand({ type: 'set-split-ratio', tabId, path, ratio })
              }
              onPrompt={(target, text) => runChatCommand({ type: 'prompt-agent', target, text })}
              onSendInput={(paneId, input) =>
                runChatCommand({ type: 'send-pane-input', paneId, ...input })
              }
              onZoom={(paneId) => onCommand({ type: 'zoom-pane', paneId, mode: 'toggle' })}
              pane={pane}
              panes={panes}
              readOutput={readPaneOutput}
              showPaneLabels={preferences.paneLabels}
            />
          </Tabs>
        </main>
      </div>
      <RenameResourceDialog
        onOpenChange={(open) => !open && setRenameTarget(null)}
        onSave={(target, label) => {
          onCommand(
            target.kind === 'workspace'
              ? { type: 'rename-workspace', workspaceId: target.id, label }
              : target.kind === 'tab'
                ? { type: 'rename-tab', tabId: target.id, label }
                : { type: 'rename-pane', paneId: target.id, label },
          );
          setRenameTarget(null);
        }}
        target={renameTarget}
      />
      <CloseResourceDialog
        onConfirm={(target) => {
          onCommand(
            target.kind === 'workspace'
              ? { type: 'close-workspace', workspaceId: target.id }
              : target.kind === 'tab'
                ? { type: 'close-tab', tabId: target.id }
                : { type: 'close-pane', paneId: target.id },
          );
          setCloseTarget(null);
        }}
        onOpenChange={(open) => !open && setCloseTarget(null)}
        target={closeTarget}
      />
      {createWorktreeSource ? (
        <CreateWorktreeDialog
          busy={busy}
          onOpenChange={(open) => !open && setCreateWorktreeSource(null)}
          onSubmit={(intent) => {
            onCommand({
              type: 'create-worktree',
              workspaceId: intent.workspaceId,
              branch: intent.branch,
              path: intent.path,
              label: intent.label,
              focus: true,
            });
            setCreateWorktreeSource(null);
          }}
          open
          sourceWorkspace={createWorktreeSource}
        />
      ) : null}
      {openWorktreeSource ? (
        <OpenWorktreeDialog
          busy={busy}
          onOpenChange={(open) => !open && setOpenWorktreeSource(null)}
          onSubmit={(intent) => {
            onCommand({
              type: 'open-worktree',
              workspaceId: intent.workspaceId,
              path: intent.path,
              focus: true,
            });
            setOpenWorktreeSource(null);
          }}
          open
          sourceWorkspace={openWorktreeSource}
        />
      ) : null}
      {removeWorktreeTarget ? (
        <RemoveWorktreeDialog
          busy={busy}
          onConfirm={(intent) => {
            onCommand({
              type: 'remove-worktree',
              workspaceId: intent.workspaceId,
              force: intent.force,
            });
            setRemoveWorktreeTarget(null);
          }}
          onOpenChange={(open) => !open && setRemoveWorktreeTarget(null)}
          open
          workspace={removeWorktreeTarget}
        />
      ) : null}
      <Dialog
        onOpenChange={(open) => !open && setPaneControlsTarget(null)}
        open={Boolean(controlsPane)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Pane controls and details</DialogTitle>
            <DialogDescription>
              Every action is sent through Herdr’s public pane API; the engine remains
              authoritative.
            </DialogDescription>
          </DialogHeader>
          {controlsPane ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
              <PaneControls
                busy={busy}
                onClearName={(paneId) => onCommand({ type: 'rename-pane', paneId })}
                onClose={(paneId) => {
                  const targetPane = snapshot.panes.find((item) => item.pane_id === paneId);
                  if (targetPane) {
                    setCloseTarget({
                      kind: 'pane',
                      id: paneId,
                      label: targetPane.label || targetPane.title || paneId,
                    });
                  }
                  setPaneControlsTarget(null);
                }}
                onFocusDirection={({ paneId, direction }) =>
                  onCommand({ type: 'focus-pane-direction', paneId, direction })
                }
                onMove={(intent: PaneMoveIntent) =>
                  onCommand({
                    type: 'move-pane',
                    paneId: intent.paneId,
                    destination: intent.destination,
                    focus: true,
                  })
                }
                onRename={(paneId) => {
                  const targetPane = snapshot.panes.find((item) => item.pane_id === paneId);
                  if (targetPane) {
                    setRenameTarget({
                      kind: 'pane',
                      id: paneId,
                      label: targetPane.label || targetPane.title || paneId,
                    });
                  }
                  setPaneControlsTarget(null);
                }}
                onResizeDirection={({ paneId, direction, amount }) =>
                  onCommand({ type: 'resize-pane', paneId, direction, amount })
                }
                onSplit={({ paneId, direction }) =>
                  onCommand({ type: 'split-pane', paneId, direction })
                }
                onSwapDirection={({ paneId, direction }) =>
                  onCommand({ type: 'swap-pane', paneId, direction })
                }
                onZoom={(paneId) => onCommand({ type: 'zoom-pane', paneId, mode: 'toggle' })}
                pane={controlsPane}
                tabs={snapshot.tabs}
                workspaces={snapshot.workspaces}
              />
              <PaneDetails pane={controlsPane} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={setMobileSwitcherOpen} open={mobileSwitcherOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Session switcher</DialogTitle>
            <DialogDescription>
              Navigate the canonical Herdr session on a compact screen.
            </DialogDescription>
          </DialogHeader>
          <MobileSwitcher
            activeSection={mobileSection}
            onFocusPane={(paneId) => {
              onCommand({ type: 'focus-pane', paneId });
              setMobileSwitcherOpen(false);
            }}
            onFocusTab={(tabId) => {
              onCommand({ type: 'focus-tab', tabId });
              setMobileSwitcherOpen(false);
            }}
            onFocusWorkspace={(targetWorkspaceId) => {
              onCommand({ type: 'focus-workspace', workspaceId: targetWorkspaceId });
              setMobileSwitcherOpen(false);
            }}
            onNewTab={(targetWorkspaceId) => {
              onCommand({ type: 'create-tab', workspaceId: targetWorkspaceId });
              setMobileSwitcherOpen(false);
            }}
            onNewWorkspace={() => {
              onCommand({ type: 'create-workspace' });
              setMobileSwitcherOpen(false);
            }}
            onOpenNavigator={() => {
              setMobileSwitcherOpen(false);
              onNavigator();
            }}
            onOpenSettings={() => {
              setMobileSwitcherOpen(false);
              onSettings();
            }}
            onOpenShortcuts={() => {
              setMobileSwitcherOpen(false);
              onShortcuts();
            }}
            onSectionChange={setMobileSection}
            snapshot={snapshot}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function installedPluginView(plugin: InstalledPluginInfo): InstalledPluginViewModel {
  return {
    id: plugin.plugin_id,
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    state: plugin.enabled ? 'enabled' : 'disabled',
    warnings: plugin.warnings,
    paneEntrypoints: plugin.panes.map((pane) => ({ id: pane.id, title: pane.title })),
  };
}

function pluginActionView(action: PluginActionInfo): PluginActionViewModel {
  return {
    pluginId: action.plugin_id,
    id: action.action_id,
    title: action.title,
    description: action.description,
    contexts: action.contexts,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function AppContent() {
  const [result, setResult] = useState<EngineBootstrap | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [pluginStatus, setPluginStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [plugins, setPlugins] = useState<InstalledPluginViewModel[]>([]);
  const [pluginActions, setPluginActions] = useState<PluginActionViewModel[]>([]);
  const [pluginError, setPluginError] = useState<string>();
  const [manifestStatus, setManifestStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [manifests, setManifests] = useState<AgentManifestInfo[]>([]);
  const [connectionState, setConnectionState] = useState<HerdrEventConnectionState>('connecting');
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateInfo | null>(null);
  const [preferences, setPreferences] = useState<DesktopPreferences>(DEFAULT_DESKTOP_PREFERENCES);
  const [remoteStatus, setRemoteStatus] = useState<RemoteEngineStatus>({
    state: 'off',
    host: '',
    port: DEFAULT_REMOTE_ENGINE_PREFERENCE.port,
  });
  const resultRequestSequence = useRef(0);
  const previousAgents = useRef<
    Extract<EngineBootstrap, { state: 'connected' }>['snapshot']['agents']
  >([]);

  const streamStateRevision = useRef(0);
  const applyLatestResult = useCallback((sequence: number, next: EngineBootstrap) => {
    if (sequence !== resultRequestSequence.current) {
      return false;
    }
    setResult(next);
    return true;
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      const sequence = ++resultRequestSequence.current;
      const streamRevision = streamStateRevision.current;
      // Background refreshes (driven by the session event stream) must not
      // flash the toolbar's busy state; only user-initiated reloads do.
      if (!quiet) {
        setBusy(true);
      }
      try {
        const next = await window.herdr.bootstrap();
        if (applyLatestResult(sequence, next) && streamStateRevision.current === streamRevision) {
          setConnectionState(next.state === 'connected' ? 'connected' : 'disconnected');
        }
      } finally {
        if (!quiet) {
          setBusy(false);
        }
      }
    },
    [applyLatestResult],
  );

  const startServer = useCallback(async () => {
    const sequence = ++resultRequestSequence.current;
    setBusy(true);
    try {
      applyLatestResult(sequence, await window.herdr.startServer());
    } finally {
      setBusy(false);
    }
  }, [applyLatestResult]);

  const runCommand = useCallback(
    async (command: HerdrCommand) => {
      const sequence = ++resultRequestSequence.current;
      setBusy(true);
      try {
        const next = await window.herdr.command(command);
        if (next.state === 'connected') {
          applyLatestResult(sequence, next);
        } else {
          toast.error(
            next.state === 'error' || next.state === 'missing'
              ? next.message
              : 'Herdr command failed.',
            {
              description: next.state === 'error' ? next.details : undefined,
            },
          );
        }
        return next;
      } finally {
        setBusy(false);
      }
    },
    [applyLatestResult],
  );

  const chooseBinary = useCallback(async () => {
    const sequence = ++resultRequestSequence.current;
    setBusy(true);
    try {
      const next = await window.herdr.chooseHerdrBinary();
      if (next) {
        applyLatestResult(sequence, next);
      }
    } catch (error) {
      toast.error('The selected file cannot run as Herdr.', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [applyLatestResult]);

  const resetBinary = useCallback(async () => {
    const sequence = ++resultRequestSequence.current;
    setBusy(true);
    try {
      applyLatestResult(sequence, await window.herdr.resetHerdrBinary());
    } finally {
      setBusy(false);
    }
  }, [applyLatestResult]);

  const updateEngine = useCallback(async (): Promise<EngineUpdateResult> => {
    const sequence = ++resultRequestSequence.current;
    setBusy(true);
    try {
      const result = await window.herdr.engineUpdate();
      applyLatestResult(sequence, result.bootstrap);
      if (result.updated) {
        toast.success(result.message);
      } else if (result.error) {
        toast.error(result.error);
      } else {
        toast(result.message);
      }
      return result;
    } catch (error) {
      toast.error('Herdr engine update failed.', {
        description: error instanceof Error ? error.message : undefined,
      });
      return {
        bootstrap: { state: 'error', message: 'Herdr engine update failed.' },
        updated: false,
        version: null,
        message: 'Herdr engine update failed.',
      };
    } finally {
      setBusy(false);
    }
  }, [applyLatestResult]);

  const checkDesktopUpdate = useCallback(async () => {
    try {
      const info = await window.herdr.checkDesktopUpdate();
      if (info.latestVersion === null) {
        toast.error('Could not check for Herdr Desktop updates.');
        return;
      }
      if (info.updateAvailable) {
        setDesktopUpdate(info);
      } else {
        toast(`Herdr Desktop is up to date (v${info.currentVersion}).`);
      }
    } catch (error) {
      toast.error('Could not check for Herdr Desktop updates.', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void window.herdr
      .readPreferences()
      .then(setPreferences)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark =
        preferences.appearance === 'dark' ||
        (preferences.appearance === 'system' && Boolean(media?.matches));
      root.classList.toggle('dark', dark);
    };
    apply();
    media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
  }, [preferences.appearance]);

  const savePreferences = useCallback(async (next: DesktopPreferences) => {
    try {
      setPreferences(await window.herdr.writePreferences(next));
    } catch (error) {
      toast.error('Desktop settings could not be saved.', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, []);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    let cancelled = false;
    void window.herdr.remoteEngineStatus().then((status) => {
      if (!cancelled) {
        setRemoteStatus(status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  const loadPlugins = useCallback(async () => {
    setPluginStatus((current) => (current === 'ready' ? current : 'loading'));
    setPluginError(undefined);
    try {
      const [installed, actions] = await Promise.all([
        window.herdr.query({ type: 'list-plugins' }),
        window.herdr.query({ type: 'list-plugin-actions' }),
      ]);
      if (installed.type !== 'plugin-list' || actions.type !== 'plugin-action-list') {
        throw new Error('Herdr returned an unexpected plugin response.');
      }
      setPlugins(installed.plugins.map(installedPluginView));
      setPluginActions(
        actions.actions
          .filter((action) => isPluginActionCompatible(action, currentPluginPlatform))
          .map(pluginActionView),
      );
      setPluginStatus('ready');
    } catch (error) {
      setPluginStatus('error');
      setPluginError(error instanceof Error ? error.message : 'Herdr plugin query failed.');
    }
  }, []);

  const openPlugins = useCallback(() => {
    setPluginsOpen(true);
    void loadPlugins();
  }, [loadPlugins]);

  const installPlugin = useCallback(
    async (intent: InstallPluginIntent) => {
      if (result?.state !== 'connected' || !result.snapshot.focused_workspace_id) {
        toast.error('Choose a Herdr workspace before installing a plugin.');
        return;
      }

      setPluginsOpen(false);
      const created = await runCommand({
        type: 'create-tab',
        workspaceId: result.snapshot.focused_workspace_id,
        label: 'plugin install',
      });
      if (created?.state !== 'connected' || !created.snapshot.focused_pane_id) {
        toast.error('Herdr did not create a terminal for the plugin installer.');
        return;
      }

      await runCommand({
        type: 'send-pane-input',
        paneId: created.snapshot.focused_pane_id,
        text: buildPluginInstallCommand(created.status.client.binary, intent),
        keys: ['enter'],
      });
    },
    [result, runCommand],
  );

  const loadManifests = useCallback(async () => {
    setManifestStatus('loading');
    try {
      const response = await window.herdr.query({ type: 'get-agent-manifests' });
      if (response.type !== 'agent-manifests') {
        throw new Error('Herdr returned an unexpected manifest response.');
      }
      setManifests(response.manifests);
      setManifestStatus('ready');
    } catch {
      setManifestStatus('error');
    }
  }, []);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    void loadManifests();
  }, [loadManifests]);

  useEffect(() => {
    // The engine streams a constant trickle of events (focus changes, layout
    // updates, transient agent tabs). Re-bootstrapping per event spawns CLI
    // processes and flashes the toolbar, so coalesce: refresh once the stream
    // has settled for a beat, never overlap an in-flight refresh, and never
    // let the snapshot age past the freshness bound even under a flood.
    const EVENT_REFRESH_SETTLE_MS = 400;
    const EVENT_REFRESH_MAX_WAIT_MS = 1_000;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let dirty = false;
    let disposed = false;
    // The mount-time load() just ran; count it as the last completion.
    let lastCompletedAt = Date.now();
    const clearTimer = () => {
      if (refreshTimer !== undefined) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
    };
    const runRefresh = async () => {
      clearTimer();
      if (disposed) {
        return;
      }
      if (inFlight) {
        // Events arrived while a bootstrap is still running; drain them
        // exactly once when it finishes instead of overlapping.
        dirty = true;
        return;
      }
      inFlight = true;
      try {
        const sinceLast = Date.now() - lastCompletedAt;
        if (sinceLast < EVENT_REFRESH_SETTLE_MS) {
          refreshTimer = setTimeout(() => void runRefresh(), EVENT_REFRESH_SETTLE_MS - sinceLast);
          return;
        }
        await load(true);
      } finally {
        inFlight = false;
        lastCompletedAt = Date.now();
      }
      if (disposed) {
        return;
      }
      if (dirty) {
        dirty = false;
        refreshTimer = setTimeout(() => void runRefresh(), 0);
      }
    };
    const scheduleRefresh = () => {
      if (disposed) {
        return;
      }
      clearTimer();
      if (inFlight) {
        dirty = true;
        return;
      }
      // Trailing settle: events reset the timer to 400ms of quiet. Under a
      // continuous flood that would starve the snapshot, so cap the wait at
      // the freshness bound.
      const sinceLast = Date.now() - lastCompletedAt;
      const wait = Math.max(
        0,
        Math.min(EVENT_REFRESH_SETTLE_MS, EVENT_REFRESH_MAX_WAIT_MS - sinceLast),
      );
      refreshTimer = setTimeout(() => void runRefresh(), wait);
    };
    const unsubscribe = window.herdr.onSessionEvent((event) => {
      if (event.event === 'desktop.remote_engine_state') {
        const candidate = event.data.status;
        if (
          isRecord(candidate) &&
          (candidate.state === 'off' ||
            candidate.state === 'starting' ||
            candidate.state === 'connected' ||
            candidate.state === 'error') &&
          typeof candidate.host === 'string' &&
          typeof candidate.port === 'number'
        ) {
          setRemoteStatus(candidate as unknown as RemoteEngineStatus);
        }
        return;
      }
      if (event.event === 'desktop.connection_state') {
        const state = event.data.state;
        if (
          state === 'connecting' ||
          state === 'connected' ||
          state === 'reconnecting' ||
          state === 'disconnected'
        ) {
          streamStateRevision.current += 1;
          setConnectionState(state);
        }
        return;
      }
      scheduleRefresh();
    });
    return () => {
      disposed = true;
      dirty = false;
      clearTimer();
      unsubscribe();
    };
  }, [load]);

  const handleDesktopAction = useCallback(
    (action: DesktopAction) => {
      if (action === 'open-settings') {
        openSettings();
        return;
      }
      if (action === 'open-navigator') {
        setNavigatorOpen(true);
        return;
      }
      if (action === 'open-shortcuts') {
        setShortcutsOpen(true);
        return;
      }
      if (action === 'open-whats-new') {
        setWhatsNewOpen(true);
        return;
      }
      if (action === 'open-plugins') {
        openPlugins();
        return;
      }
      if (action === 'refresh') {
        void load();
        return;
      }
      if (result?.state !== 'connected') {
        return;
      }

      const { snapshot } = result;
      const activeWorkspace = snapshot.workspaces.find(
        (workspace) => workspace.workspace_id === snapshot.focused_workspace_id,
      );
      const activeTab = snapshot.tabs.find((tab) => tab.tab_id === snapshot.focused_tab_id);
      const focusedPaneId = snapshot.focused_pane_id;
      if (action === 'reload-config') {
        void runCommand({ type: 'reload-server-config' });
      } else if (action === 'new-workspace') {
        void runCommand({ type: 'create-workspace' });
      } else if (action === 'new-tab' && activeWorkspace) {
        void runCommand({ type: 'create-tab', workspaceId: activeWorkspace.workspace_id });
      } else if (
        (action === 'previous-workspace' || action === 'next-workspace') &&
        activeWorkspace
      ) {
        const ordered = [...snapshot.workspaces].sort((left, right) => left.number - right.number);
        const index = ordered.findIndex(
          (workspace) => workspace.workspace_id === activeWorkspace.workspace_id,
        );
        const offset = action === 'previous-workspace' ? -1 : 1;
        const target = ordered[(index + offset + ordered.length) % ordered.length];
        if (target) {
          void runCommand({ type: 'focus-workspace', workspaceId: target.workspace_id });
        }
      } else if ((action === 'previous-tab' || action === 'next-tab') && activeTab) {
        const ordered = snapshot.tabs
          .filter((tab) => tab.workspace_id === activeTab.workspace_id)
          .sort((left, right) => left.number - right.number);
        const index = ordered.findIndex((tab) => tab.tab_id === activeTab.tab_id);
        const offset = action === 'previous-tab' ? -1 : 1;
        const target = ordered[(index + offset + ordered.length) % ordered.length];
        if (target) {
          void runCommand({ type: 'focus-tab', tabId: target.tab_id });
        }
      } else if (focusedPaneId && action.startsWith('focus-pane-')) {
        void runCommand({
          type: 'focus-pane-direction',
          paneId: focusedPaneId,
          direction: action.slice('focus-pane-'.length) as 'left' | 'right' | 'up' | 'down',
        });
      } else if (focusedPaneId && action === 'split-pane-right') {
        void runCommand({ type: 'split-pane', paneId: focusedPaneId, direction: 'right' });
      } else if (focusedPaneId && action === 'split-pane-down') {
        void runCommand({ type: 'split-pane', paneId: focusedPaneId, direction: 'down' });
      } else if (focusedPaneId && action === 'toggle-pane-zoom') {
        void runCommand({ type: 'zoom-pane', paneId: focusedPaneId, mode: 'toggle' });
      }
    },
    [load, openPlugins, openSettings, result, runCommand],
  );

  useEffect(() => window.herdr.onDesktopAction(handleDesktopAction), [handleDesktopAction]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }
      if (event.key === ',') {
        event.preventDefault();
        openSettings();
        return;
      }
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setNavigatorOpen(true);
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.key.toLowerCase() === 'r' && !event.shiftKey) {
        event.preventDefault();
        void load();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [load, openSettings]);

  useEffect(() => {
    if (result?.state !== 'connected') {
      previousAgents.current = [];
      return;
    }
    const notifications = agentNotifications(
      previousAgents.current,
      result.snapshot.agents,
      result.snapshot.focused_pane_id,
    );
    previousAgents.current = result.snapshot.agents;
    if (preferences.notificationDelivery === 'off') {
      return;
    }
    for (const notification of notifications) {
      const openPane = () => void runCommand({ type: 'focus-pane', paneId: notification.paneId });
      if (preferences.notificationDelivery === 'system') {
        void deliverSystemNotification({
          title: notification.title,
          body: notification.description,
          sound: preferences.sound,
          onOpen: openPane,
        }).then((delivered) => {
          if (!delivered) {
            toast(notification.title, {
              description: notification.description,
              action: { label: 'Open', onClick: openPane },
            });
          }
        });
        continue;
      }
      toast(notification.title, {
        description: notification.description,
        action: { label: 'Open', onClick: openPane },
      });
    }
  }, [preferences.notificationDelivery, preferences.sound, result, runCommand]);

  if (!result) {
    return <LoadingScreen />;
  }

  const binary = 'status' in result ? result.status.client.binary : 'Herdr from PATH';
  const settings = (
    <SettingsDialog
      binary={binary}
      busy={busy}
      integrations={INTEGRATION_TARGETS.map((target) => ({
        id: target,
        label: target,
        status: 'available' as const,
        detail:
          'Herdr can install or repair this integration. Structured status is not public yet.',
      }))}
      manifestStatus={manifestStatus}
      manifests={manifests}
      onChooseBinary={() => void chooseBinary()}
      onInstallIntegration={(target) =>
        void runCommand({
          type: 'install-integration',
          target: target as (typeof INTEGRATION_TARGETS)[number],
        })
      }
      onApplyRemoteEngine={(target) =>
        window.herdr.applyRemoteEngine(target).then((status) => {
          setRemoteStatus(status);
          void load();
          return status;
        })
      }
      onOpenChange={setSettingsOpen}
      onPreferencesChange={(next) => void savePreferences(next)}
      onReloadConfig={() => void runCommand({ type: 'reload-server-config' })}
      onReloadManifests={() =>
        void runCommand({ type: 'reload-agent-manifests' }).then(loadManifests)
      }
      onResetBinary={() => void resetBinary()}
      onUninstallIntegration={(target) =>
        void runCommand({
          type: 'uninstall-integration',
          target: target as (typeof INTEGRATION_TARGETS)[number],
        })
      }
      open={settingsOpen}
      preferences={preferences}
      remoteStatus={remoteStatus}
    />
  );

  if (result.state !== 'connected') {
    return (
      <>
        <OnboardingScreen
          busy={busy}
          onCheckDesktopUpdate={checkDesktopUpdate}
          onEngineUpdate={updateEngine}
          onRetry={() => void load()}
          onSettings={openSettings}
          onStart={() => void startServer()}
          result={result}
        />
        <DesktopUpdateDialog info={desktopUpdate} onClose={() => setDesktopUpdate(null)} />
        {settings}
      </>
    );
  }

  return (
    <>
      <ConnectedShell
        busy={busy}
        connectionState={connectionState}
        onCheckDesktopUpdate={checkDesktopUpdate}
        onCommand={runCommand}
        onEngineUpdate={updateEngine}
        onNavigator={() => setNavigatorOpen(true)}
        onPlugins={openPlugins}
        onPreferencesChange={(next) => void savePreferences(next)}
        onRefresh={() => void load()}
        onSettings={openSettings}
        onShortcuts={() => setShortcutsOpen(true)}
        preferences={preferences}
        result={result}
      />
      {settings}
      <Dialog onOpenChange={setNavigatorOpen} open={navigatorOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Session navigator</DialogTitle>
            <DialogDescription>Search Herdr workspaces, tabs, and panes.</DialogDescription>
          </DialogHeader>
          <Navigator
            onFocusPane={(paneId) => {
              void runCommand({ type: 'focus-pane', paneId });
              setNavigatorOpen(false);
            }}
            onFocusTab={(tabId) => {
              void runCommand({ type: 'focus-tab', tabId });
              setNavigatorOpen(false);
            }}
            onFocusWorkspace={(workspaceId) => {
              void runCommand({ type: 'focus-workspace', workspaceId });
              setNavigatorOpen(false);
            }}
            snapshot={result.snapshot}
          />
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={setPluginsOpen} open={pluginsOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="shrink-0 border-b-2 border-border px-6 py-5">
            <DialogTitle>Herdr plugins</DialogTitle>
            <DialogDescription>
              Installed plugins, public actions, and panes exposed by the running Herdr engine.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-6" data-slot="plugin-scroll-region">
            <PluginCenter
              actions={pluginActions}
              errorMessage={pluginError}
              onInstallPlugin={(intent) => void installPlugin(intent)}
              onClosePane={({ paneId }) => void runCommand({ type: 'close-plugin-pane', paneId })}
              onFocusPane={({ paneId }) => void runCommand({ type: 'focus-plugin-pane', paneId })}
              onInvokeAction={({ pluginId, actionId }) =>
                void runCommand({
                  type: 'invoke-plugin-action',
                  pluginId,
                  actionId,
                  context: {
                    workspaceId: result.snapshot.focused_workspace_id,
                    tabId: result.snapshot.focused_tab_id,
                    focusedPaneId: result.snapshot.focused_pane_id,
                    invocationSource: 'desktop-plugin-center',
                  },
                })
              }
              onOpenPane={({ pluginId, entrypoint, placement }) =>
                void runCommand({
                  type: 'open-plugin-pane',
                  pluginId,
                  entrypoint,
                  placement,
                  ...(placement === 'tab' && result.snapshot.focused_workspace_id
                    ? { workspaceId: result.snapshot.focused_workspace_id }
                    : {}),
                  ...((placement === 'split' || placement === 'zoomed') &&
                  result.snapshot.focused_pane_id
                    ? { targetPaneId: result.snapshot.focused_pane_id }
                    : {}),
                  ...(placement === 'split' ? { direction: 'right' as const } : {}),
                  focus: true,
                })
              }
              onSetPluginEnabled={({ pluginId, enabled }) => {
                void runCommand({
                  type: enabled ? 'enable-plugin' : 'disable-plugin',
                  pluginId,
                }).then(loadPlugins);
              }}
              panes={[]}
              plugins={plugins}
              status={pluginStatus}
            />
          </div>
        </DialogContent>
      </Dialog>
      <ShortcutHelpDialog onOpenChange={setShortcutsOpen} open={shortcutsOpen} />
      <WhatsNewDialog
        canLiveHandoff={Boolean(result.status.server.capabilities?.live_handoff)}
        onLiveHandoff={() =>
          void runCommand({
            type: 'live-handoff-server',
            importExe: result.status.client.binary,
            expectedProtocol: result.snapshot.protocol,
            expectedVersion: result.status.client.version,
          })
        }
        onOpenChange={setWhatsNewOpen}
        open={whatsNewOpen}
        restartNeeded={Boolean(
          result.status.update.restart_needed || result.status.server.restart_needed,
        )}
        version={packageMetadata.version}
      />
      <DesktopUpdateDialog info={desktopUpdate} onClose={() => setDesktopUpdate(null)} />
    </>
  );
}

export function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <AppContent />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
