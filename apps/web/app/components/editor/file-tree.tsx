// ============================================================
// SimpleBuild Pro — File Tree Sidebar
// Hierarchical file browser with create/rename/delete
// ============================================================

'use client';

import { useState, useMemo } from 'react';
import clsx from 'clsx';
import { useEditorStore } from '@/lib/store';
import {
  ChevronRight,
  ChevronDown,
  File,
  FileCode,
  FileImage,
  FileJson,
  FilePlus,
  FolderPlus,
  Trash2,
  Pencil,
  MoreHorizontal,
  Folder,
  FolderOpen,
} from 'lucide-react';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const filePath of paths.sort()) {
    const parts = filePath.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const nodePath = parts.slice(0, i + 1).join('/');

      let existing = current.find((n) => n.name === name);
      if (!existing) {
        existing = {
          name,
          path: nodePath,
          isFolder: !isLast,
          children: [],
        };
        current.push(existing);
      }
      current = existing.children;
    }
  }

  // Sort: folders first, then alphabetical
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({ ...n, children: sortNodes(n.children) }));
  };

  return sortNodes(root);
}

const FILE_ICONS: Record<string, typeof File> = {
  html: FileCode,
  htm: FileCode,
  css: FileCode,
  js: FileCode,
  jsx: FileCode,
  ts: FileCode,
  tsx: FileCode,
  json: FileJson,
  svg: FileImage,
  png: FileImage,
  jpg: FileImage,
  gif: FileImage,
  webp: FileImage,
};

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const Icon = FILE_ICONS[ext] || File;
  return <Icon size={14} />;
}

function getFileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const colors: Record<string, string> = {
    html: 'text-orange-500',
    htm: 'text-orange-500',
    css: 'text-blue-500',
    scss: 'text-pink-500',
    less: 'text-indigo-500',
    js: 'text-yellow-500',
    jsx: 'text-yellow-500',
    ts: 'text-blue-600',
    tsx: 'text-blue-600',
    json: 'text-green-500',
    svg: 'text-amber-500',
    md: 'text-slate-500',
    txt: 'text-slate-400',
  };
  return colors[ext] || 'text-slate-400';
}

interface FileNodeProps {
  node: TreeNode;
  depth: number;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
}

function FileNode({
  node,
  depth,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
}: FileNodeProps) {
  const { activeFile, setActiveFile, openTab } = useEditorStore();
  const [expanded, setExpanded] = useState(depth < 2);
  const isActive = !node.isFolder && activeFile === node.path;

  const handleClick = () => {
    if (node.isFolder) {
      setExpanded(!expanded);
    } else {
      setActiveFile(node.path);
      openTab(node.path);
    }
  };

  return (
    <div>
      <div
        className={clsx('file-tree-item group', isActive && 'active')}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
      >
        {/* Expand/collapse for folders */}
        {node.isFolder ? (
          <span className="shrink-0 text-slate-400">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span className="shrink-0 w-3" />
        )}

        {/* Icon */}
        <span
          className={clsx('shrink-0', node.isFolder ? 'text-slate-400' : getFileColor(node.name))}
        >
          {node.isFolder ? (
            expanded ? (
              <FolderOpen size={14} />
            ) : (
              <Folder size={14} />
            )
          ) : (
            getFileIcon(node.name)
          )}
        </span>

        {/* Name */}
        <span className="flex-1 truncate text-xs">{node.name}</span>

        {/* Context menu */}
        <div
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <Dropdown
            trigger={
              <button className="p-0.5 rounded hover:bg-slate-200 transition-colors">
                <MoreHorizontal size={12} className="text-slate-400" />
              </button>
            }
            align="left"
          >
            {node.isFolder && (
              <>
                <DropdownItem icon={<FilePlus size={12} />} onClick={() => onCreateFile(node.path)}>
                  New File
                </DropdownItem>
                <DropdownItem
                  icon={<FolderPlus size={12} />}
                  onClick={() => onCreateFolder(node.path)}
                >
                  New Folder
                </DropdownItem>
                <DropdownSeparator />
              </>
            )}
            <DropdownItem icon={<Pencil size={12} />} onClick={() => onRename(node.path)}>
              Rename
            </DropdownItem>
            <DropdownItem icon={<Trash2 size={12} />} danger onClick={() => onDelete(node.path)}>
              Delete
            </DropdownItem>
          </Dropdown>
        </div>
      </div>

      {/* Children */}
      {node.isFolder &&
        expanded &&
        node.children.map((child) => (
          <FileNode
            key={child.path}
            node={child}
            depth={depth + 1}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}

interface FileTreeProps {
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
}

export function FileTree({ onCreateFile, onCreateFolder, onRename, onDelete }: FileTreeProps) {
  const files = useEditorStore((s) => s.files);

  const tree = useMemo(() => {
    return buildTree(Array.from(files.keys()));
  }, [files]);

  return (
    <div className="py-1">
      {tree.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-slate-400">No files yet</p>
        </div>
      ) : (
        tree.map((node) => (
          <FileNode
            key={node.path}
            node={node}
            depth={0}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))
      )}
    </div>
  );
}
