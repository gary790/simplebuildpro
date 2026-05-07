// ============================================================
// SimpleBuild Pro — Editor Tab Bar
// Open file tabs with dirty indicators
// ============================================================

'use client';

import clsx from 'clsx';
import { useEditorStore } from '@/lib/store';
import { X, FileCode } from 'lucide-react';

function getExtIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const icons: Record<string, string> = {
    html: '🟠', htm: '🟠', css: '🔵', scss: '🩷', js: '🟡',
    jsx: '🟡', ts: '🔷', tsx: '🔷', json: '🟢', md: '📝',
    svg: '🟤', xml: '📄', yaml: '⚙️', yml: '⚙️',
  };
  return icons[ext] || '📄';
}

export function TabBar() {
  const { openTabs, activeFile, setActiveFile, closeTab } = useEditorStore();

  if (openTabs.length === 0) return null;

  return (
    <div className="flex items-center bg-[#252526] border-b border-[#1E1E1E] overflow-x-auto no-scrollbar">
      {openTabs.map((tab) => {
        const fileName = tab.path.split('/').pop() || tab.path;
        const isActive = activeFile === tab.path;

        return (
          <div
            key={tab.path}
            className={clsx(
              'group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-[#1E1E1E] transition-colors min-w-0 shrink-0',
              isActive
                ? 'bg-[#1E1E1E] text-[#D4D4D4]'
                : 'bg-[#2D2D2D] text-[#969696] hover:text-[#D4D4D4]',
            )}
            onClick={() => setActiveFile(tab.path)}
          >
            <span className="text-2xs leading-none">{getExtIcon(fileName)}</span>
            <span className="truncate max-w-[120px]">{fileName}</span>
            {tab.isDirty && (
              <span className="w-2 h-2 rounded-full bg-white/40 shrink-0" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.path);
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all shrink-0"
            >
              <X size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
