import { Bot, FolderKanban, Menu as MenuIcon, Rows3 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { buildMobileSwitcherModel } from '@/renderer/responsive/mobile-switcher-model';
import type { SessionSnapshot } from '@/shared/herdr';

export type MobileSwitcherSection = 'agents' | 'spaces' | 'tabs' | 'menu';

export interface CompactShellControlsProps {
  snapshot: SessionSnapshot;
  activeSection: MobileSwitcherSection;
  onSectionChange: (section: MobileSwitcherSection) => void;
}

export function CompactShellControls({
  snapshot,
  activeSection,
  onSectionChange,
}: CompactShellControlsProps) {
  const { counts } = buildMobileSwitcherModel(snapshot);

  return (
    <Tabs
      onValueChange={(value) => onSectionChange(value as MobileSwitcherSection)}
      value={activeSection}
    >
      <TabsList aria-label="Mobile switcher sections" className="grid h-auto w-full grid-cols-4">
        <TabsTrigger
          aria-label={`Agents, ${counts.agents} total, ${counts.attention} attention`}
          className="min-w-0 flex-col gap-0.5 py-2"
          value="agents"
        >
          <span className="flex items-center gap-1.5">
            <Bot aria-hidden="true" />
            <span>Agents</span>
          </span>
          <Badge className="h-5 px-1.5" variant={counts.attention > 0 ? 'default' : 'neutral'}>
            {counts.attention > 0 ? `${counts.attention}/${counts.agents}` : counts.agents}
          </Badge>
        </TabsTrigger>
        <TabsTrigger
          aria-label={`Spaces, ${counts.spaces} total`}
          className="min-w-0 flex-col gap-0.5 py-2"
          value="spaces"
        >
          <span className="flex items-center gap-1.5">
            <FolderKanban aria-hidden="true" />
            <span>Spaces</span>
          </span>
          <Badge className="h-5 px-1.5" variant="neutral">
            {counts.spaces}
          </Badge>
        </TabsTrigger>
        <TabsTrigger
          aria-label={`Tabs, ${counts.tabs} total`}
          className="min-w-0 flex-col gap-0.5 py-2"
          value="tabs"
        >
          <span className="flex items-center gap-1.5">
            <Rows3 aria-hidden="true" />
            <span>Tabs</span>
          </span>
          <Badge className="h-5 px-1.5" variant="neutral">
            {counts.tabs}
          </Badge>
        </TabsTrigger>
        <TabsTrigger aria-label="Menu" className="min-w-0 flex-col gap-0.5 py-2" value="menu">
          <MenuIcon aria-hidden="true" />
          <span>Menu</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
