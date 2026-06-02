'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, FolderOpen, Download, Lock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchLocalSkills, type LocalSkill } from '@/lib/api-skills';
import {
  isFsAccessSupported,
  getStoredHandle,
  pickAndStoreSkillsDir,
  loadSkillsFromStoredHandle,
  readSkillsFromHandle,
  reauthorizeStoredHandle,
  clearStoredHandle,
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
// Authorization gate (shown when no skills are visible and FS Access is needed)
// ---------------------------------------------------------------------------

interface AuthorizeGateProps {
  reason: 'no-permission' | 'unsupported' | 'server-empty';
  onAuthorize: () => void;
  busy: boolean;
  errorMsg: string | null;
}

function AuthorizeGate({ reason, onAuthorize, busy, errorMsg }: AuthorizeGateProps) {
  const supported = isFsAccessSupported();

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center max-w-md mx-auto">
      <div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <Lock className="size-5 text-primary" />
      </div>
      <h3 className="text-base font-semibold mb-2">授权访问本地 Skills</h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-5">
        {reason === 'unsupported' ? (
          <>
            当前浏览器不支持 File System Access API。请用 <span className="font-medium">Chrome / Edge / Arc</span>{' '}
            等 Chromium 浏览器打开,或在本地启动 dev server。
          </>
        ) : reason === 'server-empty' ? (
          <>
            未在服务端找到本地 skill 目录。点击下方按钮选择你的 skills 目录(例如{' '}
            <code className="font-mono text-[11px] bg-muted px-1 rounded">~/.claude/skills</code>)。
          </>
        ) : (
          <>
            点击下方按钮选择你的 skills 根目录(通常是{' '}
            <code className="font-mono text-[11px] bg-muted px-1 rounded">~/.claude/skills</code>)。
            授权后我们会在浏览器内读取每个子目录的{' '}
            <code className="font-mono text-[11px] bg-muted px-1 rounded">SKILL.md</code> 并展示。
            目录句柄保存在 IndexedDB,下次打开会自动尝试读取。
          </>
        )}
      </p>
      <button
        onClick={onAuthorize}
        disabled={busy || !supported}
        className={cn(
          'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {busy ? (
          <>
            <RefreshCw className="size-4 animate-spin" /> 读取中…
          </>
        ) : (
          <>
            <FolderOpen className="size-4" /> 选择 skills 目录
          </>
        )}
      </button>
      {errorMsg && (
        <p className="text-[11px] text-destructive mt-3">{errorMsg}</p>
      )}
      <p className="text-[10px] text-muted-foreground/70 mt-4 leading-relaxed">
        授权仅授予浏览器只读权限。可以随时在 Chrome 设置 → 站点权限里撤销。
      </p>
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
  const [needsReauth, setNeedsReauth] = useState(false);

  // Load order:
  //   1. server route (works in dev) -> if non-empty, done.
  //   2. previously-authorized FS handle (IndexedDB) -> if permission still
  //      granted, read and done.
  //   3. show authorize gate so user can pick a directory.
  const loadAll = useCallback(async () => {
    setLoadState('loading');
    setAuthError(null);

    // Step 1: server route
    try {
      const serverSkills = await fetchLocalSkills();
      if (serverSkills.length > 0) {
        setSkills(serverSkills);
        setLoadState('ready');
        return;
      }
    } catch {
      // 404 on Vercel — fall through to FS Access path.
    }

    // Step 2: stored handle (silent, no prompt)
    if (isFsAccessSupported()) {
      try {
        const fsSkills = await loadSkillsFromStoredHandle();
        if (fsSkills && fsSkills.length > 0) {
          setSkills(fsSkills);
          setLoadState('ready');
          return;
        }
        // Have a stored handle but permission lapsed — show re-auth gate.
        const stored = await getStoredHandle();
        if (stored) setNeedsReauth(true);
      } catch {
        // ignore — treat as needs-auth
      }
    }

    setSkills([]);
    setLoadState(isFsAccessSupported() ? 'needs-auth' : 'unsupported');
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleAuthorize = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      let handle: FileSystemDirectoryHandle | null = null;
      if (needsReauth) {
        handle = await reauthorizeStoredHandle();
        if (!handle) {
          // user declined — clear and ask for fresh pick next time
          await clearStoredHandle();
        }
      }
      if (!handle) {
        handle = await pickAndStoreSkillsDir();
      }
      const next = await readSkillsFromHandle(handle, handle.name);
      setSkills(next);
      setLoadState('ready');
      setNeedsReauth(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // AbortError is the user closing the picker — don't show as error.
      if (!/abort/i.test(message)) {
        setAuthError(message);
      }
    } finally {
      setAuthBusy(false);
    }
  }, [needsReauth]);

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
        reason={loadState === 'unsupported' ? 'unsupported' : (needsReauth ? 'no-permission' : 'server-empty')}
        onAuthorize={handleAuthorize}
        busy={authBusy}
        errorMsg={authError}
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
              <button
                onClick={async () => {
                  await clearStoredHandle();
                  loadAll();
                }}
                className="ml-auto text-[10px] text-muted-foreground hover:text-foreground hover:underline flex items-center gap-1"
                title="Re-pick the skills directory"
              >
                <FolderOpen className="size-3" /> 切换目录
              </button>
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
