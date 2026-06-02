/**
 * Client-side local skill loader using the File System Access API.
 *
 * Why this exists:
 *   The server route /api/skills/local can only read disk in dev — on Vercel
 *   it returns 404. To still surface the user's real skill catalog from a
 *   deployed build, we ask the user once to grant directory access via
 *   `window.showDirectoryPicker()`.
 *
 *   Because the user often doesn't know which exact directory to point at
 *   (`~/.claude/skills`? `~/.codex/skills`?), the picker is intentionally
 *   forgiving: pick anything reasonable (your home, ~/.claude, Documents,
 *   even ~/.claude/skills itself) and we'll **recursively discover** every
 *   `skills/` directory under it and union the contents.
 *
 *   The chosen handle is persisted to IndexedDB so subsequent visits skip
 *   the picker; permission still has to be re-granted on every page load
 *   (browser security model).
 *
 * Browser support:
 *   - Chromium / Edge: full support
 *   - Safari / Firefox: showDirectoryPicker is undefined -> caller falls
 *     back to a "use a Chromium browser or local dev server" UI.
 */

import type { LocalSkill } from './api-skills';
import { SKILL_CATALOG, UNCATEGORIZED_DEFAULTS, type SkillCatalogEntry } from './skill-catalog';

// ---------------------------------------------------------------------------
// IndexedDB tiny wrapper (single key/value store)
// ---------------------------------------------------------------------------

const DB_NAME = 'oa-local-skills';
const STORE = 'handles';
const HANDLE_KEY = 'rootDirHandle';

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
  // Older browsers without queryPermission — assume granted.
  return true;
}

export async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const h = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
    return h ?? null;
  } catch {
    return null;
  }
}

export async function clearStoredHandle(): Promise<void> {
  try { await idbDelete(HANDLE_KEY); } catch { /* ignore */ }
}

export async function pickAndStoreSkillsDir(): Promise<FileSystemDirectoryHandle> {
  if (!isFsAccessSupported()) {
    throw new Error('File System Access API is not supported in this browser.');
  }
  type DirPicker = (opts?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  const picker = (window as unknown as { showDirectoryPicker: DirPicker }).showDirectoryPicker;
  const handle = await picker({
    id: 'oa-local-skills',
    mode: 'read',
    startIn: 'documents',
  });
  await idbSet(HANDLE_KEY, handle);
  return handle;
}

// ---------------------------------------------------------------------------
// Auto-discovery: find every plausible skills directory inside a chosen root
// ---------------------------------------------------------------------------

/**
 * Hidden directories (dot-prefixed) we still want to descend into because
 * they commonly contain agent skill catalogs. Anything else hidden (`.git`,
 * `.cache`, `.Trash`, …) is skipped to avoid huge useless scans.
 */
const HIDDEN_AGENT_ROOTS = new Set([
  '.claude',
  '.codex',
  '.openclaw',
  '.aider',
  '.openagents',
  '.cursor',
  '.continue',
  '.agents',
]);

/**
 * Directories we never descend into. Most are large, irrelevant, or would
 * trigger "this folder contains system files" warnings.
 */
const SKIP_NAMES = new Set([
  'node_modules',
  'Library',
  'Pictures',
  'Movies',
  'Music',
  'Applications',
  'Public',
  'Sites',
  '.git',
  '.cache',
  '.npm',
  '.yarn',
  '.Trash',
  'venv',
  '.venv',
  '__pycache__',
  '.next',
  'dist',
  'build',
  '.pnpm',
]);

/** Quick "does this dir look like a skills container?" check. Counts a child
 *  directory as a skill if it has a SKILL.md, or counts a child .md file
 *  as a flat-style skill. We only need a couple of hits to feel confident. */
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

/**
 * Recursively find every directory named `skills` (or any directory that
 * contains skill-shaped children) under `root`. Returns up to ~6 roots.
 *
 *   ~/.claude/skills/   → returned as-is (root.name === 'skills')
 *   ~/.claude/          → finds .claude/skills
 *   ~/                  → finds .claude/skills, .codex/skills, …
 *   ~/Documents/x/      → finds nothing → caller renders "no skills found"
 */
export async function discoverSkillsRoots(
  root: FileSystemDirectoryHandle,
): Promise<{ handle: FileSystemDirectoryHandle; path: string }[]> {
  const found: { handle: FileSystemDirectoryHandle; path: string }[] = [];
  const seenNames = new Set<string>();

  async function walk(dir: FileSystemDirectoryHandle, relPath: string, depth: number) {
    if (found.length >= 8) return;
    if (depth > 3) return;

    // If this dir IS a skills container, record it and stop descending — its
    // children are individual skills, not nested skill catalogs.
    const isSkillsDir =
      dir.name === 'skills' ||
      (depth > 0 && (await looksLikeSkillsDir(dir)));
    if (isSkillsDir) {
      const key = relPath || dir.name;
      if (!seenNames.has(key)) {
        seenNames.add(key);
        found.push({ handle: dir, path: relPath || dir.name });
      }
      return;
    }

    // Otherwise, descend into a curated set of children. Avoid scanning
    // every dot-folder under home (would be slow + scary).
    let entries: FileSystemHandle[];
    try {
      entries = [];
      for await (const entry of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
        entries.push(entry);
      }
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.kind !== 'directory') continue;
      if (SKIP_NAMES.has(entry.name)) continue;

      // Hidden dirs: only descend into the agent-root whitelist
      if (entry.name.startsWith('.') && !HIDDEN_AGENT_ROOTS.has(entry.name)) continue;

      const childPath = relPath ? `${relPath}/${entry.name}` : entry.name;
      await walk(entry as FileSystemDirectoryHandle, childPath, depth + 1);
      if (found.length >= 8) return;
    }
  }

  await walk(root, root.name, 0);
  return found;
}

// ---------------------------------------------------------------------------
// Skill walking + parsing (per-skills-dir leaf reader)
// ---------------------------------------------------------------------------

/** Strip the YAML/Markdown front-matter and grab the first descriptive line. */
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

/**
 * Read every skill inside ONE skills-shaped directory.
 *   - Subdirectories: SKILL.md inside if present, slug = dir name.
 *   - Loose .md files: file is the skill, slug = basename.
 *   - Hidden entries skipped.
 */
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
        // Broken symlinks / permission-denied — skip parsing, keep entry.
      }
    } else if (entry.kind === 'file' && entry.name.endsWith('.md')) {
      slug = entry.name.replace(/\.md$/, '');
      try {
        const file = await (entry as FileSystemFileHandle).getFile();
        const text = await file.text();
        description = extractSkillSummary(text);
      } catch {
        // ignore unreadable file
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
// High-level: discover all skills under any chosen root
// ---------------------------------------------------------------------------

export interface DiscoverResult {
  skills: LocalSkill[];
  /** Pretty-printed source roots that were actually scanned. Useful for UX. */
  rootsScanned: string[];
}

/**
 * Run discoverSkillsRoots + readSkillsFromHandle for each match, dedupe by
 * slug (first-seen wins), and tag each skill with the relative path it was
 * found at so the UI can show "from .claude/skills".
 */
export async function discoverAndReadSkills(
  root: FileSystemDirectoryHandle,
): Promise<DiscoverResult> {
  const roots = await discoverSkillsRoots(root);

  // If the user picked a directory that itself looks like a skills dir but
  // discoverSkillsRoots didn't add it (e.g. user picked exactly `skills/`),
  // make sure we still scan it.
  if (roots.length === 0 && (root.name === 'skills' || (await looksLikeSkillsDir(root)))) {
    roots.push({ handle: root, path: root.name });
  }

  const out: LocalSkill[] = [];
  const seen = new Set<string>();
  const scannedLabels: string[] = [];

  for (const r of roots) {
    const label = r.path;
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

/** Convenience: pick a directory, discover, return everything. */
export async function pickAndDiscoverSkills(): Promise<DiscoverResult & { handle: FileSystemDirectoryHandle }> {
  const handle = await pickAndStoreSkillsDir();
  const result = await discoverAndReadSkills(handle);
  return { ...result, handle };
}

/**
 * Try silently re-using a previously authorized handle. Returns null if we
 * have nothing stored or permission is no longer granted (caller decides
 * whether to prompt for re-auth).
 */
export async function loadSkillsFromStoredHandle(): Promise<DiscoverResult | null> {
  const handle = await getStoredHandle();
  if (!handle) return null;
  const ok = await ensureReadPermission(handle, false);
  if (!ok) return null;
  return discoverAndReadSkills(handle);
}

/** Re-prompt for permission on an existing handle (button-driven). */
export async function reauthorizeStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await getStoredHandle();
  if (!handle) return null;
  const ok = await ensureReadPermission(handle, true);
  return ok ? handle : null;
}
