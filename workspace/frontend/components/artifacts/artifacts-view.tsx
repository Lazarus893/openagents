'use client';

import { useEffect, useMemo, useState } from 'react';
import { Package, RefreshCw, Search, Pin } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { ArtifactDetailPanel } from './artifact-detail-panel';
import type { ArtifactItem, ArtifactKind } from '@/lib/types';

// Kind → emoji + label (compact card chips)
const KIND_META: Record<ArtifactKind, { icon: string; label: string; color: string }> = {
  markdown: { icon: '📄', label: 'Markdown', color: 'text-blue-600' },
  code: { icon: '💻', label: 'Code', color: 'text-emerald-600' },
  html: { icon: '🌐', label: 'HTML', color: 'text-orange-600' },
  svg: { icon: '🎨', label: 'SVG', color: 'text-pink-600' },
  mermaid: { icon: '📊', label: 'Diagram', color: 'text-purple-600' },
  image: { icon: '🖼️', label: 'Image', color: 'text-amber-600' },
  json: { icon: '🔧', label: 'JSON', color: 'text-cyan-600' },
  pdf: { icon: '📑', label: 'PDF', color: 'text-rose-600' },
};

const SOURCE_LABELS: Record<string, string> = {
  routine: 'Routine',
  chat: 'Chat',
  manual: 'Manual',
  tool: 'Tool',
  file_promotion: 'File',
  knowledge_promotion: 'Knowledge',
};

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ArtifactsView() {
  const { artifacts, refreshArtifacts } = useWorkspace();
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<ArtifactKind | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    refreshArtifacts();
  }, [refreshArtifacts]);

  // Listen for open-artifact events from chat action cards
  useEffect(() => {
    const handleOpen = (e: Event) => {
      const id = (e as CustomEvent).detail?.id as string | undefined;
      if (!id) return;
      setSelectedId(id);
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = document.querySelector(`[data-artifact-id="${id}"]`) as HTMLElement | null;
          if (!el) return;
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-violet-500');
          setTimeout(() => el.classList.remove('ring-2', 'ring-violet-500'), 2000);
        }, 150);
      });
    };
    window.addEventListener('open-artifact', handleOpen);
    return () => window.removeEventListener('open-artifact', handleOpen);
  }, []);

  const visible = useMemo(() => {
    let list: ArtifactItem[] = artifacts.filter((a) => a.status !== 'deleted');
    if (kindFilter !== 'all') list = list.filter((a) => a.kind === kindFilter);
    if (sourceFilter !== 'all') list = list.filter((a) => a.sourceKind === sourceFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          (a.summary || '').toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    // Pinned first, then newest
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });
  }, [artifacts, kindFilter, sourceFilter, search]);

  const kindCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of artifacts) {
      if (a.status === 'deleted') continue;
      m.set(a.kind, (m.get(a.kind) || 0) + 1);
    }
    return m;
  }, [artifacts]);

  return (
    <div className="h-full flex flex-col relative">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Package className="size-4 text-violet-500 shrink-0" />
          <h2 className="text-sm font-semibold">Artifacts</h2>
          <span className="text-xs text-muted-foreground shrink-0">
            {visible.length} of {artifacts.filter((a) => a.status !== 'deleted').length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="text-xs pl-7 pr-2 py-1 rounded-md bg-muted/50 border border-input outline-none w-32 focus:w-44 transition-all"
            />
          </div>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as ArtifactKind | 'all')}
            className="text-xs px-2 py-1 rounded-md bg-muted/50 border border-input outline-none"
          >
            <option value="all">All kinds</option>
            {Object.entries(KIND_META).map(([k, m]) => (
              <option key={k} value={k}>
                {m.icon} {m.label} {kindCounts.get(k) ? `(${kindCounts.get(k)})` : ''}
              </option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="text-xs px-2 py-1 rounded-md bg-muted/50 border border-input outline-none"
          >
            <option value="all">All sources</option>
            {Object.entries(SOURCE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <button
            onClick={refreshArtifacts}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 py-16">
            <Package className="size-12 opacity-20" />
            <div className="text-center space-y-1.5 max-w-sm">
              <p className="text-sm font-medium text-foreground">
                {artifacts.length === 0 ? 'No artifacts yet' : 'No artifacts match your filters'}
              </p>
              <p className="text-xs text-muted-foreground">
                Artifacts are products created by agents and routines — markdown reports, code, diagrams, screenshots and more. They appear here automatically when an agent emits an{' '}
                <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{`<artifact>`}</code>{' '}
                tag, or when you promote a chat message manually.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {visible.map((a) => {
              const meta = KIND_META[a.kind];
              const isSelected = a.id === selectedId;
              const agentName = a.createdBy.replace(/^(openagents:|human:)/, '');
              return (
                <div
                  key={a.id}
                  data-artifact-id={a.id}
                  onClick={() => setSelectedId(a.id)}
                  className={`group rounded-lg border bg-card overflow-hidden cursor-pointer transition-all ${
                    isSelected
                      ? 'border-violet-500 shadow-md'
                      : 'border-border hover:border-primary/40 hover:shadow-sm'
                  }`}
                >
                  <div className="px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base shrink-0" title={meta.label}>{meta.icon}</span>
                      <span className="text-sm font-medium truncate flex-1">{a.title}</span>
                      {a.pinned && <Pin className="size-3 text-amber-500 shrink-0" />}
                    </div>
                    {a.summary && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{a.summary}</p>
                    )}
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-muted font-medium ${meta.color}`}>
                        {meta.label}
                      </span>
                      {a.sourceKind && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {SOURCE_LABELS[a.sourceKind] || a.sourceKind}
                        </span>
                      )}
                      {a.tags.slice(0, 2).map((t) => (
                        <span key={t} className="text-[10px] text-muted-foreground/70">#{t}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-1 text-[10px] text-muted-foreground/70">
                      <AgentAvatar name={agentName} size={14} />
                      <span className="truncate">{agentName}</span>
                      <span>·</span>
                      <span>{formatTimeAgo(a.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail panel overlay */}
      {selectedId && (
        <ArtifactDetailPanel artifactId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
