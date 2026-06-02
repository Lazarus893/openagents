/**
 * Client-side local skill loader using the File System Access API.
 *
 * Why multi-source:
 *   Chromium's showDirectoryPicker rejects (or scary-warns about) `~` and
 *   `Documents`/`Desktop` because they "contain system files". But it
 *   accepts named dot-roots like `~/.claude`, `~/.openclaw`, `~/.codex`
 *   without complaint. So we let the user authorize *multiple* directories
 *   one at a time and union the contents.
 *
 *   All handles are persisted to IndexedDB as an array. Subsequent visits
 *   silently re-read each (provided the browser still has permission).
 *
 * Browser support:
 *   Chromium / Edge / Arc: full. Safari/Firefox: showDirectoryPicker is
 *   undefined, caller falls back to a "use Chromium" message.
 */

import type { LocalSkill } from './api-skills';
import { SKILL_CATALOG, UNCATEGORIZED_DEFAULTS, type SkillCatalogEntry } from './skill-catalog';

// ---------------------------------------------------------------------------
// IndexedDB tiny wrapper
// ---------------------------------------------------------------------------

const DB_NAME = 'oa-local-skills';
const STORE = 'handles';
const SOURCES_KEY = 'sources';      // FileSystemDirectoryHandle[]
const LEGACY_KEY = 'rootDirHandle'; // single handle from earlier version

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Permission + handle helpers
// ---------------------------------------------------------------------------

export function isFsAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

interface FsHandleWithPerms {
  queryPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

async function ensureReadPermission(handle: FileSystemDirectoryHandle, prompt: boolean): Promise<boolean> {
  const h = handle as unknown as FsHandleWithPerms;
  if (typeof h.queryPermission === 'function') {
    const state = await h.queryPermission({ mode: 'read' });
    if (state === 'granted') return true;
    if (!prompt) return false;
    if (typeof h.requestPermission === 'function') {
      const next = await h.requestPermission({ mode: 'read' });
      return next === 'granted';
    }
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Source list management (the new multi-source model)
// ---------------------------------------------------------------------------

export async function listAuthorizedSources(): Promise<FileSystemDirectoryHandle[]> {
  // Migrate the old single-handle storage if it's still there.
  try {
    const legacy = await idbGet<FileSystemDirectoryHandle>(LEGACY_KEY);
    if (legacy) {
      const existing = (await idbGet<FileSystemDirectoryHandle[]>(SOURCES_KEY)) ?? [];
      const next = [...existing.filter((h) => h.name !== legacy.name), legacy];
      await idbSet(SOURCES_KEY, next);
      await idbDelete(LEGACY_KEY);
    }
  } catch {
    // ignore migration error
  }

  try {
    const arr = await idbGet<FileSystemDirectoryHandle[]>(SOURCES_KEY);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function setAuthorizedSources(sources: FileSystemDirectoryHandle[]): Promise<void> {
  await idbSet(SOURCES_KEY, sources);
}

export async function addAuthorizedSource(): Promise<FileSystemDirectoryHandle> {
  if (!isFsAccessSupported()) {
    throw new Error('File System Access API is not supported in this browser.');
  }
  type DirPicker = (opts?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  const picker = (window as unknown as { showDirectoryPicker: DirPicker }).showDirectoryPicker;
  const handle = await picker({
    id: 'oa-local-skills',
    mode: 'read',
    // No startIn — Chromium remembers the last folder per id, so the second
    // and subsequent picks land near where the user was last navigating
    // (typically the home dir after they've added one source).
  });
  const current = await listAuthorizedSources();
  // Dedupe: replace any existing source with the same name (handles get
  // serialized but isSameEntry can't check across reloads, so name match
  // is the pragmatic key).
  const next = current.filter((h) => h.name !== handle.name);
  next.push(handle);
  await setAuthorizedSources(next);
  return handle;
}

export async function removeAuthorizedSource(name: string): Promise<void> {
  const current = await listAuthorizedSources();
  const next = current.filter((h) => h.name !== name);
  await setAuthorizedSources(next);
}

export async function clearAllAuthorizedSources(): Promise<void> {
  try {
    await idbDelete(SOURCES_KEY);
    await idbDelete(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

/** Re-prompt for permission on a specific source by name. */
export async function reauthorizeSource(name: string): Promise<FileSystemDirectoryHandle | null> {
  const current = await listAuthorizedSources();
  const target = current.find((h) => h.name === name);
  if (!target) return null;
  const ok = await ensureReadPermission(target, true);
  return ok ? target : null;
}

// ---------------------------------------------------------------------------
// Auto-discovery: find every plausible skills directory inside a chosen root
// ---------------------------------------------------------------------------

const HIDDEN_AGENT_ROOTS = new Set([
  '.claude', '.codex', '.openclaw', '.aider', '.openagents',
  '.cursor', '.continue', '.agents', '.agent',
  '.qclaw', '.iflow', '.zencoder', '.adal', '.kilocode', '.kode',
  '.junie', '.mux', '.qwen', '.openhands', '.pochi', '.trae', '.trae-cn',
  '.gemini', '.windsurf', '.mcpjam', '.qoder', '.commandcode',
  '.vibe', '.factory', '.kiro', '.codebuddy', '.roo', '.neovate',
  '.augment', '.opencode', '.cc-switch', '.claude-internal', '.workbuddy',
  '.crush', '.cortex', '.snowflake', '.codeium', '.pi',
]);

const SKIP_NAMES = new Set([
  'node_modules', 'Library', 'Pictures', 'Movies', 'Music',
  'Applications', 'Public', 'Sites', 'Downloads',
  '.git', '.cache', '.npm', '.yarn', '.Trash', '.DS_Store',
  'venv', '.venv', '__pycache__', '.next', 'dist', 'build', '.pnpm',
]);

async function looksLikeSkillsDir(dir: FileSystemDirectoryHandle): Promise<boolean> {
  let hits = 0;
  try {
    for await (const entry of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
      if (hits >= 2) return true;
      if (entry.name.startsWith('.')) continue;
      if (entry.kind === 'directory') {
        const sub = entry as FileSystemDirectoryHandle;
        const skillMd = await sub.getFileHandle('SKILL.md').catch(() => null);
        if (skillMd) hits++;
      } else if (entry.kind === 'file' && entry.name.endsWith('.md') && entry.name !== 'README.md') {
        hits++;
      }
    }
  } catch {
    return false;
  }
  return hits >= 1;
}

export async function discoverSkillsRoots(
  root: FileSystemDirectoryHandle,
): Promise<{ handle: FileSystemDirectoryHandle; path: string }[]> {
  const found: { handle: FileSystemDirectoryHandle; path: string }[] = [];
  const seen = new Set<string>();

  async function walk(dir: FileSystemDirectoryHandle, relPath: string, depth: number) {
    if (found.length >= 12) return;
    if (depth > 3) return;

    const isSkillsDir =
      dir.name === 'skills' ||
      (depth > 0 && (await looksLikeSkillsDir(dir)));
    if (isSkillsDir) {
      const key = relPath || dir.name;
      if (!seen.has(key)) {
        seen.add(key);
        found.push({ handle: dir, path: relPath || dir.name });
      }
      return;
    }

    let entries: FileSystemHandle[] = [];
    try {
      for await (const entry of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
        entries.push(entry);
      }
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.kind !== 'directory') continue;
      if (SKIP_NAMES.has(entry.name)) continue;
      if (entry.name.startsWith('.') && !HIDDEN_AGENT_ROOTS.has(entry.name)) continue;

      const childPath = relPath ? `${relPath}/${entry.name}` : entry.name;
      await walk(entry as FileSystemDirectoryHandle, childPath, depth + 1);
      if (found.length >= 12) return;
    }
  }

  await walk(root, root.name, 0);
  return found;
}

// ---------------------------------------------------------------------------
// Skill walking + parsing (per-skills-dir leaf reader)
// ---------------------------------------------------------------------------

function extractSkillSummary(md: string): string {
  let body = md;
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    return line.slice(0, 160);
  }
  return '';
}

function formatName(slug: string): string {
  return slug
    .replace(/\.md$/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function readSkillsFromHandle(
  handle: FileSystemDirectoryHandle,
  sourceLabel: string,
): Promise<LocalSkill[]> {
  const skills: LocalSkill[] = [];
  const catalog: Record<string, SkillCatalogEntry> = SKILL_CATALOG;
  const uncategorized = UNCATEGORIZED_DEFAULTS;

  for await (const entry of (handle as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (entry.name.startsWith('.')) continue;

    let slug = entry.name;
    let description = '';

    if (entry.kind === 'directory') {
      slug = entry.name;
      try {
        const dirHandle = entry as FileSystemDirectoryHandle;
        const skillFile = await dirHandle.getFileHandle('SKILL.md').catch(() => null);
        if (skillFile) {
          const file = await skillFile.getFile();
          const text = await file.text();
          description = extractSkillSummary(text);
        }
      } catch {
        // broken symlink / permission denied — keep entry, skip parse
      }
    } else if (entry.kind === 'file' && entry.name.endsWith('.md')) {
      slug = entry.name.replace(/\.md$/, '');
      try {
        const file = await (entry as FileSystemFileHandle).getFile();
        const text = await file.text();
        description = extractSkillSummary(text);
      } catch {
        /* ignore unreadable file */
      }
    } else {
      continue;
    }

    const catEntry = catalog[slug] || uncategorized;
    if (!description) description = catEntry.description;

    skills.push({
      slug,
      name: formatName(slug),
      description,
      category: catEntry.category,
      categoryIcon: catEntry.categoryIcon,
      exists: true,
      sourceDir: sourceLabel,
    });
  }

  skills.sort((a, b) => a.slug.localeCompare(b.slug));
  return skills;
}

// ---------------------------------------------------------------------------
// High-level: discover + load across all authorized sources
// ---------------------------------------------------------------------------

export interface DiscoverResult {
  skills: LocalSkill[];
  rootsScanned: string[];
}

export async function discoverAndReadSkills(
  root: FileSystemDirectoryHandle,
  /** Prefix for sourceDir labels — usually the user-facing source name like ".claude". */
  labelPrefix?: string,
): Promise<DiscoverResult> {
  const roots = await discoverSkillsRoots(root);

  if (roots.length === 0 && (root.name === 'skills' || (await looksLikeSkillsDir(root)))) {
    roots.push({ handle: root, path: root.name });
  }

  const out: LocalSkill[] = [];
  const seen = new Set<string>();
  const scannedLabels: string[] = [];

  for (const r of roots) {
    const label = labelPrefix && !r.path.startsWith(labelPrefix) ? `${labelPrefix}/${r.path}` : r.path;
    scannedLabels.push(label);
    const skills = await readSkillsFromHandle(r.handle, label);
    for (const s of skills) {
      if (seen.has(s.slug)) continue;
      seen.add(s.slug);
      out.push(s);
    }
  }

  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return { skills: out, rootsScanned: scannedLabels };
}

/**
 * Walk EVERY authorized source, requesting permission silently. Returns the
 * union of all skills (deduped by slug across sources) plus telemetry
 * (which sources actually contributed and which need re-auth).
 */
export interface MultiLoadResult {
  skills: LocalSkill[];
  /** Sources whose skills were successfully read this call. */
  liveSources: string[];
  /** Sources whose permission has lapsed and need to be re-prompted. */
  staleSources: string[];
}

export async function loadSkillsFromAllSources(
  promptForPermission = false,
): Promise<MultiLoadResult> {
  const handles = await listAuthorizedSources();
  const allSkills: LocalSkill[] = [];
  const seen = new Set<string>();
  const live: string[] = [];
  const stale: string[] = [];

  for (const handle of handles) {
    const ok = await ensureReadPermission(handle, promptForPermission);
    if (!ok) {
      stale.push(handle.name);
      continue;
    }
    try {
      const result = await discoverAndReadSkills(handle, handle.name);
      live.push(handle.name);
      for (const s of result.skills) {
        if (seen.has(s.slug)) continue;
        seen.add(s.slug);
        allSkills.push(s);
      }
    } catch {
      stale.push(handle.name);
    }
  }

  allSkills.sort((a, b) => a.slug.localeCompare(b.slug));
  return { skills: allSkills, liveSources: live, staleSources: stale };
}

/**
 * Convenience: pick a directory, add it to the authorized list, then
 * immediately reload skills from ALL sources (so the new pick joins the
 * existing union).
 */
export async function pickAndAddSource(): Promise<MultiLoadResult> {
  await addAuthorizedSource();
  return loadSkillsFromAllSources();
}
