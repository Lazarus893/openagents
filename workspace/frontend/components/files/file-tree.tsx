'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, Folder, Loader2, FolderOpen, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  isFileSystemAccessSupported,
  pickDirectory,
  buildTreeFromHandle,
  registerHandle,
  readFileFromHandle,
  findHandleForPath,
} from '@/lib/browser-fs';
import { syncFilesToKnowledge } from '@/lib/knowledge-sync';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  extension?: string;
}

function getFileEmoji(extension?: string): string {
  if (!extension) return '📄';
  switch (extension.toLowerCase()) {
    case 'md':
    case 'mdx':
      return '📄';
    case 'pdf':
      return '📑';
    case 'csv':
    case 'xlsx':
    case 'xls':
      return '📊';
    case 'docx':
    case 'doc':
      return '📝';
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return '🔧';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return '🖼️';
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'py':
      return '💻';
    default:
      return '📄';
  }
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TreeNodeProps {
  node: FileNode;
  level: number;
  onSelectFile: (path: string) => void;
  selectedPath?: string;
  searchQuery?: string;
}

function TreeNode({ node, level, onSelectFile, selectedPath, searchQuery }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(level < 1);

  // Auto-expand when searching
  useEffect(() => {
    if (searchQuery && node.type === 'directory') {
      setExpanded(true);
    }
  }, [searchQuery, node.type]);

  if (node.type === 'directory') {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'w-full flex items-center gap-1.5 py-1.5 px-2 rounded-md text-left transition-colors',
            'hover:bg-zinc-100 dark:hover:bg-zinc-800/60 group'
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
        >
          <ChevronRight
            className={cn(
              'size-3.5 text-muted-foreground transition-transform shrink-0',
              expanded && 'rotate-90'
            )}
          />
          {expanded ? (
            <FolderOpen className="size-4 text-amber-500 shrink-0" />
          ) : (
            <Folder className="size-4 text-amber-500 shrink-0" />
          )}
          <span className="text-[13px] font-medium truncate">{node.name}</span>
          {hasChildren && (
            <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
              {node.children!.length}
            </span>
          )}
        </button>
        {expanded && hasChildren && (
          <div>
            {node.children!.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                level={level + 1}
                onSelectFile={onSelectFile}
                selectedPath={selectedPath}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  const isSelected = selectedPath === node.path;
  return (
    <button
      type="button"
      onClick={() => onSelectFile(node.path)}
      className={cn(
        'w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-left transition-colors',
        isSelected
          ? 'bg-zinc-100 dark:bg-zinc-800'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
      )}
      style={{ paddingLeft: `${level * 16 + 8}px` }}
    >
      <span className="text-sm shrink-0">{getFileEmoji(node.extension)}</span>
      <span className="text-[13px] truncate flex-1">{node.name}</span>
      {node.size !== undefined && node.size > 0 && (
        <span className="text-[10px] text-muted-foreground shrink-0">
          {formatSize(node.size)}
        </span>
      )}
    </button>
  );
}

interface FileTreeProps {
  onSelectFile: (path: string) => void;
  selectedPath?: string;
}

export function FileTree({ onSelectFile, selectedPath }: FileTreeProps) {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [browserMode, setBrowserMode] = useState(false);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/local-files?depth=3');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTree(data);
    } catch {
      // Server API unavailable — switch to browser mode
      setBrowserMode(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePickFolder = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      setError('您的浏览器不支持文件夹选择功能');
      return;
    }

    try {
      const handle = await pickDirectory();
      registerHandle(handle.name, handle);

      setLoading(true);
      const folderTree = await buildTreeFromHandle(handle);

      setTree((prev) => {
        if (!prev) {
          return folderTree;
        }
        // Multiple folders — merge as sibling root nodes
        if (prev.name === '__browser_root__') {
          return {
            ...prev,
            children: [...(prev.children || []), folderTree],
          };
        }
        // Wrap existing + new into a virtual root
        return {
          name: '__browser_root__',
          path: '',
          type: 'directory' as const,
          children: [prev, folderTree],
        };
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // User cancelled
      }
      setError('无法访问该文件夹，请检查权限设置');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectFileInBrowserMode = useCallback(
    async (filePath: string) => {
      const rootHandle = findHandleForPath(filePath);
      if (rootHandle) {
        try {
          const content = await readFileFromHandle(rootHandle, filePath);
          window.dispatchEvent(
            new CustomEvent('local-file-select', {
              detail: { path: filePath, content },
            })
          );
        } catch {
          window.dispatchEvent(
            new CustomEvent('local-file-select', {
              detail: { path: filePath, content: null },
            })
          );
        }
      } else {
        window.dispatchEvent(
          new CustomEvent('local-file-select', {
            detail: { path: filePath },
          })
        );
      }
    },
    []
  );

  const handleFileSelect = useCallback(
    (filePath: string) => {
      if (browserMode) {
        handleSelectFileInBrowserMode(filePath);
      } else {
        onSelectFile(filePath);
      }
    },
    [browserMode, handleSelectFileInBrowserMode, onSelectFile]
  );

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Knowledge sync: sync file changes to Knowledge entries
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!tree || tree.type !== 'directory') return;
    if (syncedRef.current) return;
    syncedRef.current = true;

    const doSync = async () => {
      try {
        const result = await syncFilesToKnowledge(
          tree,
          async (path) => {
            // Try browser FS handle first, fallback to server API
            try {
              const handle = findHandleForPath(path);
              if (handle) {
                return await readFileFromHandle(handle, path);
              }
            } catch {
              // Fallback to server API
            }
            const res = await fetch(`/api/local-files?path=${encodeURIComponent(path)}&content=true`);
            const data = await res.json();
            return data.content || '';
          },
          'default'
        );
        if (result.created > 0 || result.updated > 0) {
          window.dispatchEvent(new CustomEvent('knowledge-synced', { detail: result }));
        }
      } catch {
        // Silent fail - sync is best-effort
      }
    };

    doSync();
  }, [tree]);

  // Filter tree nodes by search
  const filterTree = useCallback((node: FileNode, query: string): FileNode | null => {
    if (!query) return node;
    const lowerQuery = query.toLowerCase();

    if (node.type === 'file') {
      return node.name.toLowerCase().includes(lowerQuery) ? node : null;
    }

    // Directory: filter children recursively
    const filteredChildren = (node.children || [])
      .map((child) => filterTree(child, query))
      .filter(Boolean) as FileNode[];

    if (filteredChildren.length === 0 && !node.name.toLowerCase().includes(lowerQuery)) {
      return null;
    }

    return { ...node, children: filteredChildren };
  }, []);

  const displayTree = tree && search ? filterTree(tree, search) : tree;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Browser mode: no tree loaded yet — show empty state with folder picker
  if (browserMode && !tree) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <FolderOpen className="size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">选择本地文件夹查看文件</p>
        {!isFileSystemAccessSupported() ? (
          <p className="text-xs text-muted-foreground/60 text-center px-4">
            您的浏览器不支持文件夹选择功能，请使用 Chrome 或 Edge 浏览器
          </p>
        ) : (
          <button
            onClick={handlePickFolder}
            className="px-4 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            选择文件夹
          </button>
        )}
      </div>
    );
  }

  if (error && !browserMode) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <p className="text-sm">{error}</p>
        <button
          onClick={fetchTree}
          className="text-xs text-primary hover:underline"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with search and add folder button */}
      <div className="px-2 pb-2 shrink-0 flex items-center gap-1.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="筛选文件..."
          className="flex-1 text-xs px-2.5 py-1.5 rounded-md bg-muted/50 border border-input outline-none text-foreground placeholder:text-muted-foreground"
        />
        {browserMode && (
          <button
            onClick={handlePickFolder}
            className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
            title="添加文件夹"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-1">
        {displayTree && displayTree.children && displayTree.children.length > 0 ? (
          displayTree.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              level={0}
              onSelectFile={handleFileSelect}
              selectedPath={selectedPath}
              searchQuery={search}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FolderOpen className="size-8 opacity-30 mb-2" />
            <p className="text-sm">
              {search ? '没有匹配的文件' : '没有找到文件'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
