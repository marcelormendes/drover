import { MessageSquareText, Pencil, RadioTower } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
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
      <div className="border-b-2 border-border p-3">
        <Label className="sr-only" htmlFor="agent-sort">
          Agent ordering
        </Label>
        <Select onValueChange={(value) => onSortChange(value as AgentSort)} value={sort}>
          <SelectTrigger aria-label="Agent ordering" id="agent-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="spaces">Group by spaces</SelectItem>
            <SelectItem value="priority">Attention priority</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div aria-live="polite" className="space-y-3 p-3">
        {orderedAgents.length ? (
          orderedAgents.map((agent) => {
            const title = agentName(agent);
            const stateLabels = Object.values(agent.state_labels);
            return (
              <article
                className="rounded-base border-2 border-border bg-background p-3 shadow-shadow"
                data-testid={`agent-card-${agent.pane_id}`}
                key={agent.pane_id}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-heading">{title}</span>
                  <Badge variant={agent.agent_status === 'blocked' ? 'default' : 'neutral'}>
                    {agent.agent_status}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge variant="neutral">{readinessLabel(agent)}</Badge>
                  <span className="truncate opacity-70">
                    {agent.workspace_id} / {agent.tab_id}
                  </span>
                </div>
                {stateLabels.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {stateLabels.map((label) => (
                      <Badge key={label} variant="neutral">
                        {label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {agent.agent_session ? (
                  <p className="mt-2 truncate font-mono text-xs" title={agent.agent_session.value}>
                    {agent.agent_session.value}
                  </p>
                ) : null}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Button
                    aria-label={`Focus ${title}`}
                    onClick={() => onFocus(agent)}
                    size="icon"
                    variant="neutral"
                  >
                    <RadioTower aria-hidden="true" />
                  </Button>
                  <Button
                    aria-label={`Rename ${title}`}
                    onClick={() => {
                      setName(agent.name || '');
                      setRenameAgent(agent);
                    }}
                    size="icon"
                    variant="neutral"
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    aria-label={`Prompt ${title}`}
                    onClick={() => setPromptAgent(agent)}
                    size="icon"
                    variant="neutral"
                  >
                    <MessageSquareText aria-hidden="true" />
                  </Button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-base border-2 border-dashed border-border p-4 text-sm">
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
