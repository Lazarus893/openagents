import type { FileNode } from '@/components/files/file-tree';

declare global {
  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
  }
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  return await window.showDirectoryPicker({ mode: 'read' });
}

// Module-level map to store directory handles for file reading
const handleRegistry = new Map<string, FileSystemDirectoryHandle>();

export function registerHandle(name: string, handle: FileSystemDirectoryHandle): void {
  handleRegistry.set(name, handle);
}

export function getRegisteredHandle(name: string): FileSystemDirectoryHandle | undefined {
  return handleRegistry.get(name);
}

export function getAllRegisteredHandles(): Map<string, FileSystemDirectoryHandle> {
  return handleRegistry;
}

export async function buildTreeFromHandle(
  handle: FileSystemDirectoryHandle,
  relativePath = '',
  depth = 3
): Promise<FileNode> {
  const currentPath = relativePath || handle.name;
  const children: FileNode[] = [];

  if (depth <= 0) {
    return {
      name: handle.name,
      path: currentPath,
      type: 'directory',
      children: [],
    };
  }

  try {
    for await (const entry of (handle as any).values()) {
      const entryPath = relativePath ? `${relativePath}/${entry.name}` : `${handle.name}/${entry.name}`;

      // Skip hidden files/directories
      if (entry.name.startsWith('.')) continue;

      if (entry.kind === 'directory') {
        const dirHandle = entry as FileSystemDirectoryHandle;
        const subtree = await buildTreeFromHandle(dirHandle, entryPath, depth - 1);
        children.push(subtree);
      } else {
        const fileHandle = entry as FileSystemFileHandle;
        let size = 0;
        try {
          const file = await fileHandle.getFile();
          size = file.size;
        } catch {
          // Permission denied or other error
        }

        const ext = entry.name.includes('.') ? entry.name.split('.').pop() || '' : '';

        children.push({
          name: entry.name,
          path: entryPath,
          type: 'file',
          size,
          extension: ext,
        });
      }
    }
  } catch {
    // Permission denied for this directory
  }

  // Sort: directories first, then alphabetical
  children.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    name: handle.name,
    path: currentPath,
    type: 'directory',
    children,
  };
}

export async function readFileFromHandle(
  rootHandle: FileSystemDirectoryHandle,
  filePath: string
): Promise<string> {
  // filePath is like "rootName/subfolder/file.md"
  // We need to skip the root name and navigate the rest
  const parts = filePath.split('/');

  // If the first segment matches the root handle name, skip it
  let segments = parts;
  if (parts[0] === rootHandle.name) {
    segments = parts.slice(1);
  }

  // Navigate to the file
  let currentHandle: FileSystemDirectoryHandle = rootHandle;
  for (let i = 0; i < segments.length - 1; i++) {
    currentHandle = await currentHandle.getDirectoryHandle(segments[i]);
  }

  const fileName = segments[segments.length - 1];
  const fileHandle = await currentHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return await file.text();
}

/**
 * Find the correct root handle for a given file path.
 * The first path segment should match a stored handle name.
 */
export function findHandleForPath(filePath: string): FileSystemDirectoryHandle | undefined {
  const rootName = filePath.split('/')[0];
  return handleRegistry.get(rootName);
}
