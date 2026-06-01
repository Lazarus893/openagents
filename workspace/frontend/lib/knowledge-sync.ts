import type { FileNode } from '@/components/files/file-tree';
import { createKnowledgeEntry, deleteKnowledgeEntry, updateKnowledgeEntry, findKnowledgeEntryBySlug } from './api-knowledge';

// Snapshot stored in localStorage for diff computation
interface FileSnapshot {
  path: string;
  size: number;
  timestamp: number; // when snapshot was taken
}

export interface SyncResult {
  created: number;
  updated: number;
  removed: number;
}

// Extension whitelist for sync
const SYNCABLE_EXTENSIONS = ['md', 'txt', 'json', 'yaml', 'yml', 'mdx'];
const MAX_CONTENT_SIZE = 50000; // 50KB - truncate after this

/**
 * Flatten a FileNode tree into a list of files (skip directories)
 */
function flattenFiles(node: FileNode, prefix = ''): { path: string; size: number; extension?: string }[] {
  const results: { path: string; size: number; extension?: string }[] = [];

  if (node.type === 'file') {
    results.push({
      path: prefix ? `${prefix}/${node.name}` : node.path,
      size: node.size || 0,
      extension: node.extension,
    });
  } else if (node.type === 'directory' && node.children) {
    const currentPath = prefix ? `${prefix}/${node.name}` : node.name;
    for (const child of node.children) {
      results.push(...flattenFiles(child, currentPath));
    }
  }

  return results;
}

/**
 * Compute diff between old snapshot and new file tree
 */
export function computeFileDiff(
  oldSnapshot: FileSnapshot[] | null,
  newTree: FileNode
): { added: string[]; modified: string[]; removed: string[] } {
  const newFiles = flattenFiles(newTree);
  const newSyncable = newFiles.filter(
    (f) => f.extension && SYNCABLE_EXTENSIONS.includes(f.extension.toLowerCase())
  );

  if (!oldSnapshot) {
    // No previous snapshot - everything is "added"
    return {
      added: newSyncable.map((f) => f.path),
      modified: [],
      removed: [],
    };
  }

  const oldMap = new Map(oldSnapshot.map((f) => [f.path, f]));
  const newMap = new Map(newSyncable.map((f) => [f.path, f]));

  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  // Find added and modified
  newMap.forEach((file, path) => {
    const old = oldMap.get(path);
    if (!old) {
      added.push(path);
    } else if (old.size !== file.size) {
      modified.push(path);
    }
  });

  // Find removed (was in old snapshot with syncable extension, not in new)
  oldMap.forEach((_, path) => {
    if (!newMap.has(path)) {
      removed.push(path);
    }
  });

  return { added, modified, removed };
}

/**
 * Convert a file path to a Knowledge slug
 */
function pathToSlug(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\//g, '-')
    .replace(/\.[^.]+$/, '') // remove extension
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Get filename without extension from a path
 */
function pathToTitle(path: string): string {
  const name = path.split('/').pop() || path;
  return name.replace(/\.[^.]+$/, '');
}

/**
 * Sync files to Knowledge. Called after Files loads.
 * @param newTree - the full file tree just loaded
 * @param readFile - function to read a file's content by relative path
 * @param workspaceId - workspace identifier for knowledge entries
 */
export async function syncFilesToKnowledge(
  newTree: FileNode,
  readFile: (path: string) => Promise<string>,
  workspaceId: string
): Promise<SyncResult> {
  const oldSnapshot = loadFileSnapshot(workspaceId);
  const diff = computeFileDiff(oldSnapshot, newTree);

  const result: SyncResult = { created: 0, updated: 0, removed: 0 };

  // Process added files
  for (const path of diff.added) {
    try {
      let content = await readFile(path);
      if (content.length > MAX_CONTENT_SIZE) {
        content = content.slice(0, MAX_CONTENT_SIZE) + '\n\n...[truncated]';
      }

      const extension = path.split('.').pop() || 'md';
      await createKnowledgeEntry({
        title: pathToTitle(path),
        slug: pathToSlug(path),
        content,
        contentType: 'markdown',
        knowledgeType: 'global',
        category: extension,
        isFolder: false,
        position: 0,
        workspaceId,
      });
      result.created++;
    } catch {
      // Skip files that fail to read
    }
  }

  // Process modified files
  for (const path of diff.modified) {
    try {
      let content = await readFile(path);
      if (content.length > MAX_CONTENT_SIZE) {
        content = content.slice(0, MAX_CONTENT_SIZE) + '\n\n...[truncated]';
      }

      const extension = path.split('.').pop() || 'md';
      const slug = pathToSlug(path);
      const existing = await findKnowledgeEntryBySlug(slug, workspaceId);
      if (existing?.id) {
        await updateKnowledgeEntry(existing.id, { content });
      } else {
        // No existing row found — fall through to create
        await createKnowledgeEntry({
          title: pathToTitle(path),
          slug,
          content,
          contentType: 'markdown',
          knowledgeType: 'global',
          category: extension,
          isFolder: false,
          position: 0,
          workspaceId,
        });
      }
      result.updated++;
    } catch {
      // Skip files that fail to read
    }
  }

  // Process removed files - skip in mock mode (IDs are fixed)
  for (const path of diff.removed) {
    try {
      const slug = pathToSlug(path);
      // In mock mode, deleteKnowledgeEntry silently fails which is acceptable
      await deleteKnowledgeEntry(slug);
      result.removed++;
    } catch {
      // Silent fail for removals
    }
  }

  // Save current state as new snapshot
  saveFileSnapshot(newTree, workspaceId);

  return result;
}

/**
 * Save current file tree as snapshot to localStorage
 */
export function saveFileSnapshot(tree: FileNode, workspaceId: string): void {
  try {
    const files = flattenFiles(tree);
    const syncableFiles = files.filter(
      (f) => f.extension && SYNCABLE_EXTENSIONS.includes(f.extension.toLowerCase())
    );

    const snapshot: FileSnapshot[] = syncableFiles.map((f) => ({
      path: f.path,
      size: f.size,
      timestamp: Date.now(),
    }));

    localStorage.setItem(`knowledge-sync-snapshot:${workspaceId}`, JSON.stringify(snapshot));
  } catch {
    // localStorage might be full or unavailable
  }
}

/**
 * Load previous snapshot from localStorage
 */
export function loadFileSnapshot(workspaceId: string): FileSnapshot[] | null {
  try {
    const raw = localStorage.getItem(`knowledge-sync-snapshot:${workspaceId}`);
    if (!raw) return null;
    return JSON.parse(raw) as FileSnapshot[];
  } catch {
    return null;
  }
}
