import { MessageSquareText, Pencil } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { statusDotClass } from '@/renderer/status';
import type { AgentInfo, AgentStatus } from '@/shared/herdr';

export type AgentSort = 'spaces' | 'priority';

interface AgentSidebarProps {
  agents: AgentInfo[];
  sort: AgentSort;
  onSortChange: (sort: AgentSort) => void;
  onFocus: (agent: AgentInfo) => void;
  onRename: (target: string, name: string) => void;
  onPrompt: (target: string, text: string) => void;
}

const attentionOrder: Record<AgentStatus, number> = {
  blocked: 0,
  done: 1,
  working: 2,
  idle: 3,
  unknown: 4,
};

function agentName(agent: AgentInfo): string {
  return agent.name || agent.display_agent || agent.agent || agent.pane_id;
}

function readinessLabel(agent: AgentInfo): string {
  if (agent.launch_pending) {
    return 'Launching';
  }
  if (agent.interactive_ready) {
    return 'Ready';
  }
  if (agent.screen_detection_skipped) {
    return 'Detection limited';
  }
  return 'Waiting';
}

function compareAgents(left: AgentInfo, right: AgentInfo, sort: AgentSort): number {
  if (sort === 'priority') {
    const byAttention = attentionOrder[left.agent_status] - attentionOrder[right.agent_status];
    if (byAttention !== 0) {
      return byAttention;
    }
    const byChange = right.state_change_seq - left.state_change_seq;
    if (byChange !== 0) {
      return byChange;
    }
  } else {
    const byWorkspace = left.workspace_id.localeCompare(right.workspace_id, undefined, {
      numeric: true,
    });
    if (byWorkspace !== 0) {
      return byWorkspace;
    }
  }
  return left.pane_id.localeCompare(right.pane_id, undefined, { numeric: true });
}

export function AgentSidebar({
  agents,
  sort,
  onSortChange,
  onFocus,
  onRename,
  onPrompt,
}: AgentSidebarProps) {
  const orderedAgents = useMemo(
    () => [...agents].sort((left, right) => compareAgents(left, right, sort)),
    [agents, sort],
  );
  const [renameAgent, setRenameAgent] = useState<AgentInfo | null>(null);
  const [promptAgent, setPromptAgent] = useState<AgentInfo | null>(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');

  const submitRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!renameAgent || !nextName) {
      return;
    }
    onRename(renameAgent.pane_id, nextName);
    setRenameAgent(null);
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!promptAgent || !text) {
      return;
    }
    onPrompt(promptAgent.pane_id, text);
    setPromptAgent(null);
    setPrompt('');
  };

  return (
    <section aria-label="Agents" className="flex min-h-0 flex-col">
      <div className="px-2 pt-1.5">
        <Label className="sr-only" htmlFor="agent-sort">
          Agent ordering
        </Label>
        <Select onValueChange={(value) => onSortChange(value as AgentSort)} value={sort}>
          <SelectTrigger
            aria-label="Agent ordering"
            className="h-7 w-auto gap-1 border-0 bg-transparent px-2 font-mono text-[11px] text-foreground opacity-60 hover:bg-accent-surface hover:opacity-100"
            id="agent-sort"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="spaces">Group by spaces</SelectItem>
            <SelectItem value="priority">Attention priority</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div aria-live="polite" className="space-y-0.5 p-2">
        {orderedAgents.length ? (
          orderedAgents.map((agent) => {
            const title = agentName(agent);
            const stateLabel = Object.values(agent.state_labels)[0];
            return (
              <div
                className="group/agent relative"
                data-testid={`agent-card-${agent.pane_id}`}
                key={agent.pane_id}
              >
                <button
                  aria-label={`Focus ${title}`}
                  className="flex w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-base px-2.5 py-2 text-left transition-colors hover:bg-accent-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onFocus(agent)}
                  type="button"
                >
                  <span className="flex w-full min-w-0 items-center gap-2.5">
                    <span aria-hidden="true" className={statusDotClass(agent.agent_status)} />
                    <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[11px] opacity-60 transition-opacity group-focus-within/agent:opacity-0 group-hover/agent:opacity-0',
                        agent.agent_status === 'blocked' && 'text-chart-2 opacity-100',
                      )}
                    >
                      {agent.agent_status}
                    </span>
                  </span>
                  <span className="flex w-full min-w-0 items-center gap-1.5 pl-[22px] font-mono text-[11px] opacity-50">
                    <span className="truncate">
                      {agent.workspace_id} · {agent.tab_id}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0">{readinessLabel(agent)}</span>
                  </span>
                  {stateLabel ? (
                    <span className="w-full truncate pl-[22px] font-mono text-[11px] opacity-50">
                      {stateLabel}
                    </span>
                  ) : null}
                  {agent.agent_session ? (
                    <span
                      className="w-full truncate pl-[22px] font-mono text-[11px] opacity-40"
                      title={agent.agent_session.value}
                    >
                      {agent.agent_session.value}
                    </span>
                  ) : null}
                </button>
                <span className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 focus-within:opacity-100 group-hover/agent:opacity-100">
                  <button
                    aria-label={`Rename ${title}`}
                    className="grid size-6 place-items-center rounded-base bg-secondary-background opacity-70 hover:bg-background hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setName(agent.name || '');
                      setRenameAgent(agent);
                    }}
                    type="button"
                  >
                    <Pencil aria-hidden="true" className="size-3" />
                  </button>
                  <button
                    aria-label={`Prompt ${title}`}
                    className="grid size-6 place-items-center rounded-base bg-secondary-background opacity-70 hover:bg-background hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setPromptAgent(agent)}
                    type="button"
                  >
                    <MessageSquareText aria-hidden="true" className="size-3" />
                  </button>
                </span>
              </div>
            );
          })
        ) : (
          <div className="px-2.5 py-3 font-mono text-xs opacity-50">
            No agents are active in this session.
          </div>
        )}
      </div>

      <Dialog onOpenChange={(open) => !open && setRenameAgent(null)} open={Boolean(renameAgent)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename agent</DialogTitle>
            <DialogDescription>Herdr stores this name with the canonical agent.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitRename}>
            <Label htmlFor="agent-rename">Agent name</Label>
            <Input
              autoFocus
              id="agent-rename"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
            <DialogFooter>
              <Button disabled={!name.trim()} type="submit">
                Save agent name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => !open && setPromptAgent(null)} open={Boolean(promptAgent)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prompt agent</DialogTitle>
            <DialogDescription>
              Herdr sends the prompt to the selected agent-owned terminal.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitPrompt}>
            <Label htmlFor="agent-prompt">Prompt</Label>
            <Textarea
              autoFocus
              id="agent-prompt"
              onChange={(event) => setPrompt(event.target.value)}
              value={prompt}
            />
            <DialogFooter>
              <Button disabled={!prompt.trim()} type="submit">
                Send prompt
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
