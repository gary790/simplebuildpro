// ============================================================
// SimpleBuild Pro — Preview Panel (Phase 2: Sandbox Architecture)
// Uses sandbox URL for live preview when available,
// falls back to client-side blob preview for offline mode
// ============================================================

'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useEditorStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import {
  RefreshCw, ExternalLink, Maximize2, Minimize2,
  Monitor, Smartphone, Tablet, Eye, Loader2, Server,
} from 'lucide-react';
import clsx from 'clsx';

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

const deviceWidths: Record<DeviceMode, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

export function PreviewPanel() {
  const { files, sandboxUrl, sandboxStatus } = useEditorStore();

  const [device, setDevice] = useState<DeviceMode>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const hasIndex = files.has('index.html') || files.has('index.htm');

  // Determine if we should use sandbox URL or fallback to blob preview
  const useSandbox = !!sandboxUrl && sandboxStatus === 'running';

  // Build the fallback preview HTML by combining project files (offline mode)
  const previewHtml = useMemo(() => {
    if (useSandbox) return null; // Don't build blob when sandbox is available

    const indexHtml = files.get('index.html') || files.get('index.htm') || '';
    if (!indexHtml) return null;

    let html = indexHtml;

    // Inline CSS files referenced via <link> tags
    const cssFiles = Array.from(files.entries()).filter(([path]) =>
      path.endsWith('.css')
    );
    for (const [path, content] of cssFiles) {
      const linkRegex = new RegExp(
        `<link[^>]*href=["']${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
        'gi'
      );
      if (linkRegex.test(html)) {
        html = html.replace(linkRegex, `<style>/* ${path} */\n${content}\n</style>`);
      } else {
        const basename = path.split('/').pop() || path;
        const linkRegex2 = new RegExp(
          `<link[^>]*href=["'](\\.?\\/?)${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
          'gi'
        );
        if (linkRegex2.test(html)) {
          html = html.replace(linkRegex2, `<style>/* ${path} */\n${content}\n</style>`);
        }
      }
    }

    // Inline JS files referenced via <script src="...">
    const jsFiles = Array.from(files.entries()).filter(([path]) =>
      path.endsWith('.js') || path.endsWith('.mjs')
    );
    for (const [path, content] of jsFiles) {
      const scriptRegex = new RegExp(
        `<script[^>]*src=["']${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>\\s*</script>`,
        'gi'
      );
      if (scriptRegex.test(html)) {
        html = html.replace(scriptRegex, `<script>/* ${path} */\n${content}\n</script>`);
      } else {
        const basename = path.split('/').pop() || path;
        const scriptRegex2 = new RegExp(
          `<script[^>]*src=["'](\\.?\\/?)${basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>\\s*</script>`,
          'gi'
        );
        if (scriptRegex2.test(html)) {
          html = html.replace(scriptRegex2, `<script>/* ${path} */\n${content}\n</script>`);
        }
      }
    }

    return html;
  }, [files, useSandbox]);

  // Auto-refresh fallback preview with debounce when files change
  useEffect(() => {
    if (useSandbox || !autoRefresh || !previewHtml || !iframeRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (iframeRef.current && previewHtml) {
        const blob = new Blob([previewHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        iframeRef.current.src = url;
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [previewHtml, autoRefresh, useSandbox]);

  const refreshPreview = useCallback(() => {
    if (useSandbox) {
      // Force iframe reload by changing key
      setRefreshKey(k => k + 1);
    } else if (iframeRef.current && previewHtml) {
      const blob = new Blob([previewHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      iframeRef.current.src = url;
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }, [previewHtml, useSandbox]);

  const openInNewTab = useCallback(() => {
    if (useSandbox && sandboxUrl) {
      window.open(sandboxUrl, '_blank');
    } else if (previewHtml) {
      const blob = new Blob([previewHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }, [previewHtml, useSandbox, sandboxUrl]);

  const hasPreview = useSandbox || (hasIndex && previewHtml);

  return (
    <div className={clsx(
      'flex flex-col h-full bg-white',
      fullscreen && 'fixed inset-0 z-50',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-slate-200 bg-slate-50 shrink-0">
        <span className="text-xs font-semibold text-slate-600">
          Preview
          {useSandbox && (
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs bg-green-100 text-green-700 font-medium">
              <Server size={9} className="mr-0.5" />
              Sandbox
            </span>
          )}
          {!useSandbox && hasIndex && (
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs bg-blue-100 text-blue-700 font-medium">
              Local
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {/* Device Toggle */}
          {hasPreview && (
            <div className="flex items-center border border-slate-200 rounded-md overflow-hidden mr-1">
              {([
                { mode: 'desktop' as DeviceMode, Icon: Monitor },
                { mode: 'tablet' as DeviceMode, Icon: Tablet },
                { mode: 'mobile' as DeviceMode, Icon: Smartphone },
              ]).map(({ mode, Icon }) => (
                <button
                  key={mode}
                  onClick={() => setDevice(mode)}
                  className={clsx(
                    'p-1 transition-colors',
                    device === mode ? 'bg-slate-200 text-slate-700' : 'text-slate-400 hover:text-slate-600',
                  )}
                >
                  <Icon size={12} />
                </button>
              ))}
            </div>
          )}

          {/* Controls */}
          {hasPreview && (
            <>
              <button onClick={refreshPreview} className="p-1 rounded hover:bg-slate-200 text-slate-500 transition-colors" title="Refresh">
                <RefreshCw size={12} />
              </button>
              <button onClick={openInNewTab} className="p-1 rounded hover:bg-slate-200 text-slate-500 transition-colors" title="Open in new tab">
                <ExternalLink size={12} />
              </button>
              {!useSandbox && (
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={clsx(
                    'p-1 rounded transition-colors',
                    autoRefresh ? 'bg-green-100 text-green-600' : 'text-slate-400 hover:bg-slate-200',
                  )}
                  title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
                >
                  <Eye size={12} />
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="p-1 rounded hover:bg-slate-200 text-slate-500 transition-colors"
          >
            {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>

      {/* Preview Content */}
      <div className="flex-1 bg-[#f0f0f0] flex items-center justify-center overflow-hidden">
        {/* Sandbox creating state */}
        {sandboxStatus === 'creating' && (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center">
              <Loader2 size={20} className="text-amber-500 animate-spin" />
            </div>
            <p className="text-sm font-medium text-slate-700">Starting sandbox...</p>
            <p className="text-xs text-slate-500">
              Spinning up a Linux container for your project. This takes a few seconds.
            </p>
          </div>
        )}

        {/* Sandbox running — show iframe with sandbox URL */}
        {useSandbox && sandboxUrl && (
          <div
            className="h-full bg-white shadow-lg transition-all duration-200"
            style={{ width: deviceWidths[device], maxWidth: '100%' }}
          >
            <iframe
              key={refreshKey}
              src={sandboxUrl}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              title="Sandbox Preview"
            />
          </div>
        )}

        {/* Fallback: client-side blob preview (no sandbox) */}
        {!useSandbox && sandboxStatus !== 'creating' && hasIndex && previewHtml && (
          <div
            className="h-full bg-white shadow-lg transition-all duration-200"
            style={{ width: deviceWidths[device], maxWidth: '100%' }}
          >
            <iframe
              ref={iframeRef}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              title="Preview"
            />
          </div>
        )}

        {/* No preview available */}
        {!useSandbox && sandboxStatus !== 'creating' && !hasIndex && (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-slate-200 flex items-center justify-center">
              <Monitor size={20} className="text-slate-400" />
            </div>
            <p className="text-xs text-slate-500">
              Ask the AI to build something — the preview will appear here automatically
            </p>
          </div>
        )}

        {/* Has index but no preview html yet */}
        {!useSandbox && sandboxStatus !== 'creating' && hasIndex && !previewHtml && (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <p className="text-xs text-slate-500">
              Waiting for content...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
