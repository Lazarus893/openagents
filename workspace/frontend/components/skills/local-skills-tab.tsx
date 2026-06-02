'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, FolderOpen, Download, Lock, RefreshCw, Plus, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchLocalSkills, type LocalSkill } from '@/lib/api-skills';
import {
  isFsAccessSupported,
  listAuthorizedSources,
  addAuthorizedSource,
  removeAuthorizedSource,
  loadSkillsFromAllSources,
  reauthorizeSource,
  clearAllAuthorizedSources,
} from '@/lib/local-skills-fs';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const LOCAL_CATEGORIES = [
  { id: 'all', label: 'All', icon: '🔥' },
  { id: 'AI & Reasoning', label: 'AI & Reasoning', icon: '🧠' },
  { id: 'Design & UI', label: 'Design & UI', icon: '🎨' },
  { id: 'Dev Tools', label: 'Dev Tools', icon: '⚙️' },
  { id: 'Docs & Content', label: 'Docs & Content', icon: '📄' },
  { id: 'Integration & Automation', label: 'Integration', icon: '🔗' },
  { id: 'Media & Creative', label: 'Media', icon: '🎬' },
  { id: 'Web & Search', label: 'Web & Search', icon: '🌐' },
  { id: 'Data & Analysis', label: 'Data', icon: '📊' },
  { id: 'Engineering Practices', label: 'Engineering', icon: '🛠️' },
  { id: 'Life & Productivity', label: 'Life', icon: '🏠' },
  { id: 'System & CLI', label: 'System & CLI', icon: '🔧' },
];

// Common skill paths — these are hints shown to the user, not auto-resolvable.
// The picker can't navigate to them programmatically (browser security), but
// users can paste them via Cmd+Shift+G in the file dialog on macOS.
const SUGGESTED_PATHS = [
  { path: '~/.claude', desc: 'Claude Code (~150 skills)' },
  { path: '~/.openclaw', desc: 'OpenClaw (~100)' },
  { path: '~/.codex', desc: 'Codex' },
  { path: '~/.cursor', desc: 'Cursor IDE' },
  { path: '~/.continue', desc: 'Continue' },
  { path: '~/.gemini', desc: 'Gemini' },
];

// ---------------------------------------------------------------------------
// Skill Card
// ---------------------------------------------------------------------------

function LocalSkillCard({ skill, onSelect }: { skill: LocalSkill; onSelect: (s: LocalSkill) => void }) {
  return (
    <button
      className="text-left rounded-xl border border-border bg-card p-4 transition-all duration-150 hover:shadow-lg hover:border-primary/30 hover:-translate-y-0.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onClick={() => onSelect(skill)}
    >
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0 text-base">
          {skill.categoryIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[13px] font-semibold leading-tight truncate">{skill.name}</h3>
            {skill.exists && (
              <span className="shrink-0 size-1.5 rounded-full bg-green-500" title="Installed locally" />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 mt-0.5">
            {skill.description || 'No description available'}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between mt-2.5 ml-12">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium shrink-0">
            {skill.category}
          </span>
          {skill.sourceDir && (
            <span
              className="text-[9px] text-muted-foreground/70 truncate"
              title={`from ${skill.sourceDir}`}
            >
              from {skill.sourceDir}
            </span>
          )}
        </div>
        <span className="text-[10px] text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
          <FolderOpen className="size-2.5" /> Details
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Empty / first-time auth gate
// ---------------------------------------------------------------------------

interface AuthorizeGateProps {
  onAddSource: () => void;
  busy: boolean;
  errorMsg: string | null;
  unsupported: boolean;
}

function AuthorizeGate({ onAddSource, busy, errorMsg, unsupported }: AuthorizeGateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 text-center max-w-xl mx-auto">
      <div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <Lock className="size-5 text-primary" />
      </div>
      <h3 className="text-base font-semibold mb-2">连接你的本地 Skills</h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-5">
        {unsupported ? (
          <>
            当前浏览器不支持 File System Access API。请使用{' '}
            <span className="font-medium">Chrome / Edge / Arc</span> 等 Chromium 浏览器。
          </>
        ) : (
          <>
            浏览器不允许直接选 home 目录(会弹"包含系统文件"警告)。
            <b>建议每次选一个 agent 目录</b>(下方常见路径),
            授权后会自动扫描里面的 skills 并永久记住,可以再加更多目录。
          </>
        )}
      </p>

      {!unsupported && (
        <>
          <div className="w-full mb-5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 text-left">
              常见 skill 目录
            </div>
            <div className="grid grid-cols-2 gap-2 text-left">
              {SUGGESTED_PATHS.map((p) => (
                <div
                  key={p.path}
                  className="rounded-lg border border-border bg-muted/30 px-2.5 py-2"
                >
                  <code className="text-[11px] font-mono text-foreground block">{p.path}</code>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{p.desc}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/70 mt-2 text-left">
              💡 文件夹选择器里按 <kbd className="font-mono bg-muted px-1 rounded">⌘⇧G</kbd> 可以输入路径,
              或者从 Finder 拖一个文件夹到选择器。
            </p>
          </div>

          <button
            onClick={onAddSource}
            disabled={busy}
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {busy ? (
              <>
                <RefreshCw className="size-4 animate-spin" /> 扫描中…
              </>
            ) : (
              <>
                <FolderOpen className="size-4" /> 添加 skill 目录
              </>
            )}
          </button>
        </>
      )}

      {errorMsg && (
        <p className="text-[11px] text-destructive mt-3 max-w-md">{errorMsg}</p>
      )}
      <p className="text-[10px] text-muted-foreground/70 mt-5 leading-relaxed">
        授权仅授予浏览器只读权限,可在 Chrome 设置 → 站点权限里随时撤销。
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source chip bar (shown above grid when there are authorized sources)
// ---------------------------------------------------------------------------

interface SourceBarProps {
  sources: string[];
  staleSources: string[];
  onAdd: () => void;
  onRemove: (name: string) => void;
  onReauth: (name: string) => void;
  busy: boolean;
}

function SourceBar({ sources, staleSources, onAdd, onRemove, onReauth, busy }: SourceBarProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mr-1">
        来源:
      </span>
      {sources.map((name) => {
        const stale = staleSources.includes(name);
        return (
          <span
            key={name}
            className={cn(
              'inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[10px] font-medium',
              stale
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                : 'bg-muted text-foreground',
            )}
            title={stale ? '权限已失效,点击重新授权' : `~/${name}`}
          >
            {stale && <AlertTriangle className="size-2.5" />}
            <code className="font-mono">~/{name}</code>
            {stale ? (
              <button
                onClick={() => onReauth(name)}
                className="ml-0.5 px-1 hover:bg-amber-500/20 rounded text-[9px]"
              >
                重授权
              </button>
            ) : null}
            <button
              onClick={() => onRemove(name)}
              className="ml-0.5 hover:bg-foreground/10 rounded p-0.5"
              title="移除此来源"
            >
              <X className="size-2.5" />
            </button>
          </span>
        );
      })}
      <button
        onClick={onAdd}
        disabled={busy}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors',
          'border border-dashed border-input hover:border-primary/40 hover:text-primary',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <Plus className="size-2.5" />
        添加目录
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface LocalSkillsTabProps {
  onSelectSkill: (skill: LocalSkill) => void;
}

type LoadState = 'loading' | 'ready' | 'needs-auth' | 'unsupported';

export function LocalSkillsTab({ onSelectSkill }: LocalSkillsTabProps) {
  const [skills, setSkills] = useState<LocalSkill[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeSources, setActiveSources] = useState<string[]>([]);
  const [staleSources, setStaleSources] = useState<string[]>([]);

  // Load order:
  //   1. server route (works in dev) -> if non-empty, done.
  //   2. authorized FS sources -> silent re-read; show chip list w/ stale badges.
  //   3. show first-time auth gate.
  const loadAll = useCallback(async () => {
    setLoadState('loading');
    setAuthError(null);

    // Step 1: server route (dev only)
    try {
      const serverSkills = await fetchLocalSkills();
      if (serverSkills.length > 0) {
        setSkills(serverSkills);
        setActiveSources([]);
        setStaleSources([]);
        setLoadState('ready');
        return;
      }
    } catch {
      // 404 on Vercel — fall through.
    }

    // Step 2: authorized FS sources
    if (isFsAccessSupported()) {
      const stored = await listAuthorizedSources();
      if (stored.length > 0) {
        const result = await loadSkillsFromAllSources(false);
        setSkills(result.skills);
        setActiveSources(stored.map((h) => h.name));
        setStaleSources(result.staleSources);
        setLoadState('ready');
        return;
      }
    }

    // Step 3: first-time gate
    setSkills([]);
    setActiveSources([]);
    setStaleSources([]);
    setLoadState(isFsAccessSupported() ? 'needs-auth' : 'unsupported');
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const refreshFromCurrent = useCallback(async (promptForStale = false) => {
    const stored = await listAuthorizedSources();
    if (stored.length === 0) {
      setSkills([]);
      setActiveSources([]);
      setStaleSources([]);
      setLoadState('needs-auth');
      return;
    }
    const result = await loadSkillsFromAllSources(promptForStale);
    setSkills(result.skills);
    setActiveSources(stored.map((h) => h.name));
    setStaleSources(result.staleSources);
    setLoadState('ready');
  }, []);

  const handleAddSource = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await addAuthorizedSource();
      await refreshFromCurrent(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/abort/i.test(message)) {
        setAuthError(message);
      }
    } finally {
      setAuthBusy(false);
    }
  }, [refreshFromCurrent]);

  const handleRemoveSource = useCallback(async (name: string) => {
    await removeAuthorizedSource(name);
    await refreshFromCurrent(false);
  }, [refreshFromCurrent]);

  const handleReauthSource = useCallback(async (name: string) => {
    setAuthBusy(true);
    try {
      await reauthorizeSource(name);
      await refreshFromCurrent(false);
    } finally {
      setAuthBusy(false);
    }
  }, [refreshFromCurrent]);

  const filtered = useMemo(() => {
    let result = skills;
    if (activeCategory !== 'all') {
      result = result.filter((s) => s.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q)
      );
    }
    return result;
  }, [skills, search, activeCategory]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: skills.length };
    for (const s of skills) {
      counts[s.category] = (counts[s.category] || 0) + 1;
    }
    return counts;
  }, [skills]);

  if (loadState === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading local skills...</p>
        </div>
      </div>
    );
  }

  if (loadState === 'needs-auth' || loadState === 'unsupported') {
    return (
      <AuthorizeGate
        onAddSource={handleAddSource}
        busy={authBusy}
        errorMsg={authError}
        unsupported={loadState === 'unsupported'}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search & Filters */}
      <div className="shrink-0 px-4 pt-3 pb-2 space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search local skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-muted/50 border border-input placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {activeSources.length > 0 && (
          <SourceBar
            sources={activeSources}
            staleSources={staleSources}
            onAdd={handleAddSource}
            onRemove={handleRemoveSource}
            onReauth={handleReauthSource}
            busy={authBusy}
          />
        )}

        {/* Category chips */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
          {LOCAL_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                'shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors',
                activeCategory === cat.id
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="text-xs">{cat.icon}</span>
              <span>{cat.label}</span>
              {categoryCounts[cat.id] !== undefined && (
                <span className="text-[9px] opacity-60">({categoryCounts[cat.id]})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
            <Search className="size-8 opacity-30" />
            <p className="text-sm">No skills match your search</p>
            <button
              onClick={() => { setSearch(''); setActiveCategory('all'); }}
              className="text-xs text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Download className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {activeCategory === 'all' ? 'All Local Skills' : activeCategory}
              </span>
              <span className="text-[10px] text-muted-foreground">({filtered.length})</span>
              {activeSources.length > 0 && (
                <button
                  onClick={async () => {
                    await clearAllAuthorizedSources();
                    loadAll();
                  }}
                  className="ml-auto text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                  title="移除所有授权来源,重新开始"
                >
                  全部清除
                </button>
              )}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
              {filtered.map((skill) => (
                <LocalSkillCard key={skill.slug} skill={skill} onSelect={onSelectSkill} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
