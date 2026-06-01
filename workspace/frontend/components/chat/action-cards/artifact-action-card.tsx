'use client';

import { useEffect, useState } from 'react';
import { Package, ExternalLink } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import type { ArtifactItem, ArtifactKind } from '@/lib/types';

const KIND_META: Record<ArtifactKind, { icon: string; label: string; accent: string }> = {
  markdown: { icon: '📄', label: 'Markdown', accent: 'border-l-blue-500' },
  code: { icon: '💻', label: 'Code', accent: 'border-l-emerald-500' },
  html: { icon: '🌐', label: 'HTML', accent: 'border-l-orange-500' },
  svg: { icon: '🎨', label: 'SVG', accent: 'border-l-pink-500' },
  mermaid: { icon: '📊', label: 'Diagram', accent: 'border-l-purple-500' },
  image: { icon: '🖼️', label: 'Image', accent: 'border-l-amber-500' },
  json: { icon: '🔧', label: 'JSON', accent: 'border-l-cyan-500' },
  pdf: { icon: '📑', label: 'PDF', accent: 'border-l-rose-500' },
};

interface ArtifactActionCardProps {
  artifactId: string;
  onOpen?: (entity: { type: string; id: string }) => void;
}

/** Compact artifact card embedded in chat. Tries the workspace's `artifacts`
 *  cache first; otherwise lazy-loads detail via API. */
export function ArtifactActionCard({ artifactId, onOpen }: ArtifactActionCardProps) {
  const { artifacts } = useWorkspace();
  const cached = artifacts.find((a) => a.id === artifactId);
  const [artifact, setArtifact] = useState<ArtifactItem | null>(cached || null);

  useEffect(() => {
    if (artifact) return;
    let cancelled = false;
    workspaceApi.getArtifact(artifactId)
      .then((a) => { if (!cancelled) setArtifact(a); })
      .catch(() => { /* gone */ });
    return () => { cancelled = true; };
  }, [artifactId, artifact]);

  if (!artifact) {
    return (
      <div className="rounded-lg border bg-muted/30 border-l-4 border-l-zinc-300 max-w-sm p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Package className="size-3.5 animate-pulse" />
          <span>Loading artifact…</span>
        </div>
      </div>
    );
  }

  const meta = KIND_META[artifact.kind] || KIND_META.markdown;

  return (
    <div
      onClick={() => onOpen?.({ type: 'artifact', id: artifact.id })}
      className={`group rounded-lg border bg-muted/30 border-l-4 ${meta.accent} max-w-sm p-3 space-y-1.5 cursor-pointer hover:bg-muted/50 transition-colors`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Package className="size-3.5" />
        <span>Artifact created</span>
        <ExternalLink className="size-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="flex items-start gap-2">
        <span className="text-base shrink-0">{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground leading-snug truncate">
            {artifact.title}
          </p>
          {artifact.summary && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{artifact.summary}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
          {meta.label}
        </span>
        {artifact.version > 1 && (
          <span className="text-[10px] text-muted-foreground">v{artifact.version}</span>
        )}
      </div>
    </div>
  );
}
