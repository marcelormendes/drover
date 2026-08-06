import { Bot, FolderKanban, Keyboard, Plus, Search, Settings, SquareTerminal } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  CompactShellControls,
  type MobileSwitcherSection,
} from '@/renderer/responsive/CompactShellControls';
import {
  buildMobileSwitcherModel,
  type MobileSwitcherModel,
} from '@/renderer/responsive/mobile-switcher-model';
import type { AgentInfo, AgentStatus, SessionSnapshot } from '@/shared/herdr';

export interface MobileSwitcherProps {
  snapshot: SessionSnapshot;
  activeSection: MobileSwitcherSection;
  onSectionChange: (section: MobileSwitcherSection) => void;
  onFocusWorkspace: (workspaceId: string) => void;
  onFocusTab: (tabId: string) => void;
  onFocusPane: (paneId: string) => void;
  onOpenNavigator: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onNewWorkspace: () => void;
  onNewTab: (workspaceId: string) => void;
}

const statusColor: Record<AgentStatus, string> = {
  blocked: 'bg-chart-2',
  done: 'bg-chart-4',
  idle: 'bg-secondary-background',
  unknown: 'bg-chart-3',
  working: 'bg-chart-1',
};

function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <Badge className="gap-1.5" variant={status === 'blocked' ? 'default' : 'neutral'}>
      <span
        aria-hidden="true"
        className={`size-2 rounded-full border border-border ${statusColor[status]}`}
      />
      {status}
    </Badge>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-base border-2 border-dashed border-border bg-background p-6 text-center text-sm">
      {children}
    </div>
  );
}

const agentName = (agent: AgentInfo) =>
  agent.name || agent.display_agent || agent.agent || agent.pane_id;

interface SectionProps {
  snapshot: SessionSnapshot;
  model: MobileSwitcherModel;
  onFocusWorkspace: MobileSwitcherProps['onFocusWorkspace'];
  onFocusTab: MobileSwitcherProps['onFocusTab'];
  onFocusPane: MobileSwitcherProps['onFocusPane'];
  onOpenNavigator: MobileSwitcherProps['onOpenNavigator'];
  onOpenSettings: MobileSwitcherProps['onOpenSettings'];
  onOpenShortcuts: MobileSwitcherProps['onOpenShortcuts'];
  onNewWorkspace: MobileSwitcherProps['onNewWorkspace'];
  onNewTab: MobileSwitcherProps['onNewTab'];
}

function AgentsSection({
  snapshot,
  model,
  onFocusPane,
}: Pick<SectionProps, 'snapshot' | 'model' | 'onFocusPane'>) {
  const workspaces = new Map(model.spaces.map((workspace) => [workspace.workspace_id, workspace]));
  const tabs = new Map(snapshot.tabs.map((tab) => [tab.tab_id, tab]));
  const attentionLabel =
    model.attentionCount === 1
      ? '1 agent needs attention'
      : `${model.attentionCount} agents need attention`;

  return (
    <section aria-label="Agents" className="space-y-3">
      <div aria-live="polite" className="flex items-center gap-2 font-heading">
        <Bot aria-hidden="true" className="size-5" />
        <span>{attentionLabel}</span>
      </div>
      {model.agents.length === 0 ? (
        <EmptyState>No agents running</EmptyState>
      ) : (
        <div className="space-y-2">
          {model.agents.map((agent) => {
            const name = agentName(agent);
            const workspace = workspaces.get(agent.workspace_id);
            const tab = tabs.get(agent.tab_id);
            const location = `${workspace?.label ?? agent.workspace_id} · ${tab?.label ?? agent.tab_id}`;
            return (
              <Button
                aria-label={`Focus agent ${name}`}
                className="h-auto w-full justify-start whitespace-normal p-3 text-left"
                key={agent.pane_id}
                onClick={() => onFocusPane(agent.pane_id)}
                type="button"
                variant={agent.focused ? 'default' : 'neutral'}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-heading">{name}</span>
                  <span className="block truncate text-xs opacity-70">{location}</span>
                </span>
                <StatusBadge status={agent.agent_status} />
              </Button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SpacesSection({
  model,
  onFocusWorkspace,
  onNewWorkspace,
}: Pick<SectionProps, 'model' | 'onFocusWorkspace' | 'onNewWorkspace'>) {
  return (
    <section aria-label="Spaces" className="space-y-3">
      {model.spaces.length === 0 ? (
        <EmptyState>No spaces yet</EmptyState>
      ) : (
        <div className="space-y-2">
          {model.spaces.map((workspace) => (
            <Button
              aria-label={`Focus workspace ${workspace.label}`}
              className="h-auto w-full justify-start whitespace-normal p-3 text-left"
              key={workspace.workspace_id}
              onClick={() => onFocusWorkspace(workspace.workspace_id)}
              type="button"
              variant={
                workspace.workspace_id === model.activeWorkspace?.workspace_id
                  ? 'default'
                  : 'neutral'
              }
            >
              <FolderKanban aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-heading">{workspace.label}</span>
                <span className="block text-xs opacity-70">
                  {workspace.tab_count} tabs · {workspace.pane_count} panes
                </span>
              </span>
              <StatusBadge status={workspace.agent_status} />
            </Button>
          ))}
        </div>
      )}
      <Button className="w-full" onClick={onNewWorkspace} type="button">
        <Plus aria-hidden="true" />
        New workspace
      </Button>
    </section>
  );
}

function TabsSection({
  model,
  onFocusTab,
  onNewTab,
}: Pick<SectionProps, 'model' | 'onFocusTab' | 'onNewTab'>) {
  const activeWorkspace = model.activeWorkspace;
  return (
    <section aria-label="Tabs" className="space-y-3">
      {model.tabs.length === 0 ? (
        <EmptyState>No tabs in the active space</EmptyState>
      ) : (
        <div className="space-y-2">
          {model.tabs.map((tab) => (
            <Button
              aria-label={`Focus tab ${tab.label}`}
              className="h-auto w-full justify-start whitespace-normal p-3 text-left"
              key={tab.tab_id}
              onClick={() => onFocusTab(tab.tab_id)}
              type="button"
              variant={tab.tab_id === model.activeTab?.tab_id ? 'default' : 'neutral'}
            >
              <SquareTerminal aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-heading">{tab.label}</span>
                <span className="block text-xs opacity-70">
                  {tab.pane_count} {tab.pane_count === 1 ? 'pane' : 'panes'}
                </span>
              </span>
              <StatusBadge status={tab.agent_status} />
            </Button>
          ))}
        </div>
      )}
      <Button
        aria-label={activeWorkspace ? `New tab in ${activeWorkspace.label}` : 'New tab'}
        className="w-full"
        disabled={!activeWorkspace}
        onClick={() => activeWorkspace && onNewTab(activeWorkspace.workspace_id)}
        type="button"
      >
        <Plus aria-hidden="true" />
        {activeWorkspace ? `New tab in ${activeWorkspace.label}` : 'New tab'}
      </Button>
    </section>
  );
}

function MenuSection({
  model,
  onOpenNavigator,
  onOpenSettings,
  onOpenShortcuts,
  onNewWorkspace,
  onNewTab,
}: Pick<
  SectionProps,
  'model' | 'onOpenNavigator' | 'onOpenSettings' | 'onOpenShortcuts' | 'onNewWorkspace' | 'onNewTab'
>) {
  const activeWorkspace = model.activeWorkspace;
  return (
    <section aria-label="Menu" className="grid gap-3">
      <Button className="justify-start" onClick={onOpenNavigator} type="button" variant="neutral">
        <Search aria-hidden="true" />
        Open Navigator
      </Button>
      <Button className="justify-start" onClick={onOpenSettings} type="button" variant="neutral">
        <Settings aria-hidden="true" />
        Open settings
      </Button>
      <Button className="justify-start" onClick={onOpenShortcuts} type="button" variant="neutral">
        <Keyboard aria-hidden="true" />
        Open keyboard shortcuts
      </Button>
      <Button className="justify-start" onClick={onNewWorkspace} type="button">
        <Plus aria-hidden="true" />
        Create workspace
      </Button>
      <Button
        aria-label={activeWorkspace ? `Create tab in ${activeWorkspace.label}` : 'Create tab'}
        className="justify-start"
        disabled={!activeWorkspace}
        onClick={() => activeWorkspace && onNewTab(activeWorkspace.workspace_id)}
        type="button"
      >
        <Plus aria-hidden="true" />
        {activeWorkspace ? `Create tab in ${activeWorkspace.label}` : 'Create tab'}
      </Button>
    </section>
  );
}

export function MobileSwitcher({
  snapshot,
  activeSection,
  onSectionChange,
  onFocusWorkspace,
  onFocusTab,
  onFocusPane,
  onOpenNavigator,
  onOpenSettings,
  onOpenShortcuts,
  onNewWorkspace,
  onNewTab,
}: MobileSwitcherProps) {
  const model = buildMobileSwitcherModel(snapshot);
  const sectionProps: SectionProps = {
    snapshot,
    model,
    onFocusWorkspace,
    onFocusTab,
    onFocusPane,
    onOpenNavigator,
    onOpenSettings,
    onOpenShortcuts,
    onNewWorkspace,
    onNewTab,
  };

  return (
    <Card aria-label="Mobile session switcher" className="gap-0 overflow-hidden p-0" role="region">
      <div className="border-b-2 border-border bg-secondary-background p-2">
        <CompactShellControls
          activeSection={activeSection}
          onSectionChange={onSectionChange}
          snapshot={snapshot}
        />
      </div>
      <div className="min-h-0 overflow-y-auto bg-secondary-background p-3">
        {activeSection === 'agents' ? <AgentsSection {...sectionProps} /> : null}
        {activeSection === 'spaces' ? <SpacesSection {...sectionProps} /> : null}
        {activeSection === 'tabs' ? <TabsSection {...sectionProps} /> : null}
        {activeSection === 'menu' ? <MenuSection {...sectionProps} /> : null}
      </div>
    </Card>
  );
}
