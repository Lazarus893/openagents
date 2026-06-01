'use client';

import { useState } from 'react';
import { Sparkles, Monitor, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { LocalSkillsTab } from './local-skills-tab';
import { OnlineSkillsTab } from './online-skills-tab';
import { SkillDetailPanel } from './skill-detail-panel';
import { type LocalSkill, type OnlineSkill } from '@/lib/api-skills';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = 'local' | 'online';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'local', label: 'Local Skills', icon: <Monitor className="size-3.5" /> },
  { id: 'online', label: 'Online Hub', icon: <Globe className="size-3.5" /> },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function SkillsView() {
  const { agents, refreshAgents } = useWorkspace();
  const [activeTab, setActiveTab] = useState<TabId>('local');
  const [selectedSkill, setSelectedSkill] = useState<LocalSkill | OnlineSkill | null>(null);

  const handleInstall = async (agentName: string, skillSlug: string) => {
    try {
      await workspaceApi.installSkill(agentName, skillSlug);
      toast.success(`Installed "${skillSlug}" for ${agentName}`);
      if (refreshAgents) await refreshAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to install skill');
    }
  };

  const handleUninstall = async (agentName: string, skillSlug: string) => {
    try {
      await workspaceApi.uninstallSkill(agentName, skillSlug);
      toast.success(`Uninstalled "${skillSlug}" from ${agentName}`);
      if (refreshAgents) await refreshAgents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to uninstall skill');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-5 pt-4 pb-0 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="size-4 text-amber-500" />
          <h2 className="text-sm font-semibold">Skill Hub</h2>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-colors border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'bg-primary/10 text-primary border-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent',
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'local' ? (
          <LocalSkillsTab onSelectSkill={setSelectedSkill} />
        ) : (
          <OnlineSkillsTab onSelectSkill={setSelectedSkill} />
        )}
      </div>

      {/* Detail Panel */}
      {selectedSkill && (
        <SkillDetailPanel
          skill={selectedSkill}
          agents={agents}
          onClose={() => setSelectedSkill(null)}
          onInstall={handleInstall}
          onUninstall={handleUninstall}
        />
      )}
    </div>
  );
}
