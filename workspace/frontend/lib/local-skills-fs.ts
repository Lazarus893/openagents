/**
 * Client-side local skill loader using the File System Access API.
 *
 * Why this exists:
 *   The server route /api/skills/local can only read disk in dev — on Vercel
 *   it returns 404. To still surface the user's real skill catalog from a
 *   deployed build, we ask the user once to grant directory access (e.g.
 *   `~/.claude/skills`) via `window.showDirectoryPicker()`. The handle is
 *   persisted to IndexedDB so subsequent visits skip the picker.
 *
 *   Permission state still has to be re-verified on every page load (browser
 *   security model — we cannot silently re-read a granted directory across
 *   sessions without `queryPermission`/`requestPermission`).
 *
 * Browser support:
 *   - Chromium / Edge: full support
 *   - Safari / Firefox: showDirectoryPicker is undefined -> we degrade
 *     gracefully and the UI falls back to "browse readonly catalog" mode.
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
// Skill walking + parsing
// ---------------------------------------------------------------------------

/** Strip the YAML/Markdown front-matter and grab the first descriptive line. */
function extractSkillSummary(md: string): string {
  let body = md;
  // Strip --- front-matter ---
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
 * Walk the chosen directory and turn each immediate child into a LocalSkill.
 * - Subdirectories: read SKILL.md inside if present.
 * - Loose .md files: treat the file itself as the skill (description = first line).
 *
 * Hidden entries (starting with `.`) are skipped — they're rarely intended skills
 * and `~/.claude/skills/.system` is more clutter than signal.
 */
export async function readSkillsFromHandle(
  handle: FileSystemDirectoryHandle,
  sourceLabel: string,
): Promise<LocalSkill[]> {
  const skills: LocalSkill[] = [];
  const catalog: Record<string, SkillCatalogEntry> = SKILL_CATALOG;
  const uncategorized = UNCATEGORIZED_DEFAULTS;

  // @ts-expect-error — values() exists at runtime on FileSystemDirectoryHandle
  for await (const entry of handle.values() as AsyncIterable<FileSystemHandle>) {
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
        // Some symlinks / permission-denied entries fail here — just skip parsing.
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

  // Stable alphabetical order so the UI doesn't reshuffle on every reload.
  skills.sort((a, b) => a.slug.localeCompare(b.slug));
  return skills;
}

/**
 * High-level convenience: try to load skills from a previously-authorized
 * handle. Returns null if there is no stored handle or permission was lost
 * (caller can decide whether to prompt).
 */
export async function loadSkillsFromStoredHandle(): Promise<LocalSkill[] | null> {
  const handle = await getStoredHandle();
  if (!handle) return null;
  const ok = await ensureReadPermission(handle, false);
  if (!ok) return null;
  return readSkillsFromHandle(handle, handle.name);
}

/** Re-prompt for permission on an existing handle (button-driven). */
export async function reauthorizeStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await getStoredHandle();
  if (!handle) return null;
  const ok = await ensureReadPermission(handle, true);
  return ok ? handle : null;
}
