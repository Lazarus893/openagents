'use client';

import { useEffect, useState } from 'react';
import {
  X, Pin, Trash2, Share2, Copy, Check, Link2, BookOpen, ExternalLink,
  AlertCircle, Loader2, Edit3,
} from 'lucide-react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { ArtifactRenderer } from './renderers/artifact-renderer';
import type { ArtifactItem, ArtifactKind } from '@/lib/types';

const KIND_META: Record<ArtifactKind, { icon: string; label: string }> = {
  markdown: { icon: '📄', label: 'Markdown' },
  code: { icon: '💻', label: 'Code' },
  html: { icon: '🌐', label: 'HTML' },
  svg: { icon: '🎨', label: 'SVG' },
  mermaid: { icon: '📊', label: 'Diagram' },
  image: { icon: '🖼️', label: 'Image' },
  json: { icon: '🔧', label: 'JSON' },
  pdf: { icon: '📑', label: 'PDF' },
};

interface ArtifactDetailPanelProps {
  artifactId: string;
  onClose: () => void;
}

export function ArtifactDetailPanel({ artifactId, onClose }: ArtifactDetailPanelProps) {
  const { refreshArtifacts, sessions, setCurrentSessionId } = useWorkspace();
  const { setViewMode } = useLayout();
  const [artifact, setArtifact] = useState<ArtifactItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Load full detail (including content)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    workspaceApi.getArtifact(artifactId)
      .then((a) => { if (!cancelled) { setArtifact(a); setTitleDraft(a.title); } })
      .catch((err) => { if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [artifactId]);

  if (loading) {
    return (
      <div className="absolute inset-0 bg-background/95 backdrop-blur z-30 flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!artifact) {
    return (
      <div className="absolute inset-0 bg-background z-30 flex items-center justify-center">
        <div className="text-center space-y-2 text-muted-foreground">
          <AlertCircle className="size-8 mx-auto text-amber-500" />
          <p className="text-sm">Artifact not found</p>
          <button onClick={onClose} className="text-xs text-primary hover:underline">Close</button>
        </div>
      </div>
    );
  }

  const meta = KIND_META[artifact.kind];
  const agentName = artifact.createdBy.replace(/^(openagents:|human:)/, '');

  const handleTitleSave = async () => {
    const t = titleDraft.trim();
    setEditingTitle(false);
    if (!t || t === artifact.title) return;
    try {
      const updated = await workspaceApi.updateArtifact(artifact.id, { title: t });
      setArtifact({ ...artifact, ...updated });
      await refreshArtifacts();
      toast.success('Title updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update title');
    }
  };

  const handleTogglePin = async () => {
    setBusy('pin');
    try {
      const updated = await workspaceApi.updateArtifact(artifact.id, { pinned: !artifact.pinned });
      setArtifact({ ...artifact, ...updated });
      await refreshArtifacts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update pin');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${artifact.title}"? This cannot be undone.`)) return;
    setBusy('delete');
    try {
      await workspaceApi.deleteArtifact(artifact.id);
      await refreshArtifacts();
      toast.success('Artifact deleted');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
      setBusy(null);
    }
  };

  const handleShare = async () => {
    setBusy('share');
    try {
      const result = await workspaceApi.shareArtifact(artifact.id);
      const updated = { ...artifact, shareToken: result.shareToken };
      setArtifact(updated);
      await refreshArtifacts();
      toast.success('Public link created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to share');
    } finally {
      setBusy(null);
    }
  };

  const handleUnshare = async () => {
    if (!confirm('Revoke public link? Anyone with the URL will lose access.')) return;
    setBusy('unshare');
    try {
      await workspaceApi.unshareArtifact(artifact.id);
      setArtifact({ ...artifact, shareToken: null });
      await refreshArtifacts();
      toast.success('Public link revoked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke');
    } finally {
      setBusy(null);
    }
  };

  const handlePromote = async () => {
    if (!['markdown', 'code', 'json', 'html'].includes(artifact.kind)) {
      toast.error(`Cannot promote ${artifact.kind} to knowledge`);
      return;
    }
    setBusy('promote');
    try {
      const result = await workspaceApi.promoteArtifactToKnowledge(artifact.id);
      toast.success(`Saved to Knowledge as "${result.title}"`);
      // Refresh and stay; user can navigate via the knowledge link below
      const refreshed = await workspaceApi.getArtifact(artifact.id);
      setArtifact(refreshed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to promote');
    } finally {
      setBusy(null);
    }
  };

  const copyShareLink = async () => {
    if (!artifact.shareToken) return;
    const apiOrigin = (workspaceApi as unknown as { baseUrl?: string }).baseUrl ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    const url = `${apiOrigin}/v1/artifacts/public/${artifact.shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleOpenSource = () => {
    if (artifact.sourceKind === 'chat' && artifact.sourceChannel) {
      const session = sessions.find((s) => s.sessionId === artifact.sourceChannel);
      if (session) {
        setCurrentSessionId(session.sessionId);
        setViewMode('threads');
      }
    } else if (artifact.sourceKind === 'routine' && artifact.sourceId) {
      setViewMode('routines');
      window.dispatchEvent(new CustomEvent('open-routine', { detail: { id: artifact.sourceId } }));
    }
  };

  const knowledgeId = artifact.metadata?.knowledge_entry_id as string | undefined;

  return (
    <div className="absolute inset-0 bg-background z-30 flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-start gap-2">
        <div className="text-xl mt-0.5 shrink-0">{meta.icon}</div>
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleSave();
                if (e.key === 'Escape') { setTitleDraft(artifact.title); setEditingTitle(false); }
              }}
              className="w-full text-base font-semibold bg-transparent border-b border-primary outline-none"
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="text-base font-semibold text-left hover:text-primary transition-colors group flex items-center gap-2"
            >
              <span className="truncate">{artifact.title}</span>
              <Edit3 className="size-3.5 opacity-0 group-hover:opacity-100 text-muted-foreground" />
            </button>
          )}
          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
            <span className="px-1.5 py-0.5 rounded-full bg-muted">{meta.label}</span>
            {artifact.sourceKind && (
              <button
                onClick={handleOpenSource}
                className="px-1.5 py-0.5 rounded-full bg-muted hover:bg-muted/80 inline-flex items-center gap-1 transition-colors"
                title="Open source"
              >
                from {artifact.sourceKind}
                <ExternalLink className="size-2.5" />
              </button>
            )}
            <AgentAvatar name={agentName} size={14} />
            <span>{agentName}</span>
            {artifact.version > 1 && <span>· v{artifact.version}</span>}
          </div>
          {artifact.summary && (
            <p className="text-xs text-muted-foreground mt-1.5">{artifact.summary}</p>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={handleTogglePin}
            disabled={busy === 'pin'}
            className={`p-1.5 rounded-md hover:bg-muted transition-colors ${
              artifact.pinned ? 'text-amber-500' : 'text-muted-foreground'
            }`}
            title={artifact.pinned ? 'Unpin' : 'Pin'}
          >
            <Pin className="size-3.5" />
          </button>
          {artifact.shareToken ? (
            <button
              onClick={handleUnshare}
              disabled={busy === 'unshare'}
              className="p-1.5 rounded-md hover:bg-muted text-emerald-600 transition-colors"
              title="Public — click to revoke"
            >
              <Link2 className="size-3.5" />
            </button>
          ) : (
            <button
              onClick={handleShare}
              disabled={busy === 'share'}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
              title="Share publicly"
            >
              {busy === 'share' ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
            </button>
          )}
          {['markdown', 'code', 'json', 'html'].includes(artifact.kind) && !knowledgeId && (
            <button
              onClick={handlePromote}
              disabled={busy === 'promote'}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
              title="Save to Knowledge"
            >
              {busy === 'promote' ? <Loader2 className="size-3.5 animate-spin" /> : <BookOpen className="size-3.5" />}
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={busy === 'delete'}
            className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors"
            title="Delete"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Public link banner */}
      {artifact.shareToken && (
        <div className="shrink-0 px-4 py-2 border-b border-border bg-emerald-50 dark:bg-emerald-950/20 flex items-center gap-2">
          <Link2 className="size-3.5 text-emerald-600" />
          <span className="text-[11px] text-emerald-700 dark:text-emerald-400">Public</span>
          <code className="text-[11px] flex-1 truncate font-mono text-muted-foreground">
            /v1/artifacts/public/{artifact.shareToken}
          </code>
          <button
            onClick={copyShareLink}
            className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
          >
            {linkCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {linkCopied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {/* Knowledge linkback */}
      {knowledgeId && (
        <div className="shrink-0 px-4 py-2 border-b border-border bg-blue-50 dark:bg-blue-950/20 flex items-center gap-2">
          <BookOpen className="size-3.5 text-blue-600" />
          <span className="text-[11px] text-blue-700 dark:text-blue-400">Saved to Knowledge</span>
          <button
            onClick={() => {
              setViewMode('knowledge');
              window.dispatchEvent(new CustomEvent('open-knowledge', { detail: { id: knowledgeId } }));
            }}
            className="text-[11px] text-blue-700 dark:text-blue-400 hover:underline ml-auto inline-flex items-center gap-1"
          >
            Open <ExternalLink className="size-2.5" />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        <ArtifactRenderer artifact={artifact} />
      </div>

      {/* Tags footer */}
      {artifact.tags.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-border flex items-center gap-1 flex-wrap">
          {artifact.tags.map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              #{t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
