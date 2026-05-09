// ============================================================
// SimpleBuild Pro — Preview Panel (Phase 3: WebContainer)
// Priority: WebContainer iframe (instant, zero latency)
// Fallback: Client-side blob preview (for non-WebContainer browsers)
// Legacy: E2B sandbox URL (kept for backward compat)
// ============================================================

'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useEditorStore } from '@/lib/store';
import * as wc from '@/lib/webcontainer';
import { Button } from '@/components/ui/button';
import {
  RefreshCw, ExternalLink, Maximize2, Minimize2,
  Monitor, Smartphone, Tablet, Loader2, Zap,
} from 'lucide-react';
import clsx from 'clsx';

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

const deviceWidths: Record<DeviceMode, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

export function PreviewPanel() {
  const { files, webcontainerReady, webcontainerUrl, sandboxUrl, sandboxStatus } = useEditorStore();

  const [device, setDevice] = useState<DeviceMode>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Find any HTML file in the project for blob preview
  const htmlFile = useMemo(() => {
    // Priority: index.html > any .html file
    if (files.has('index.html')) return 'index.html';
    if (files.has('index.htm')) return 'index.htm';
    for (const path of files.keys()) {
      if (path.endsWith('/index.html') || path.endsWith('/index.htm')) return path;
    }
    for (const path of files.keys()) {
      if (path.endsWith('.html') || path.endsWith('.htm')) return path;
    }
    return null;
  }, [files]);

  const hasHtml = !!htmlFile;

  // Priority: WebContainer URL (only if it produced a real server URL) > Blob fallback
  // WebContainer boot alone is NOT enough — it must produce a URL via dev server.
  const useWebcontainer = webcontainerReady && !!webcontainerUrl;
  const useSandbox = !useWebcontainer && !!sandboxUrl && sandboxStatus === 'running';
  const useBlobPreview = !useWebcontainer && !useSandbox && hasHtml;

  // Active preview URL (WebContainer or Sandbox)
  const previewUrl = useWebcontainer ? webcontainerUrl : useSandbox ? sandboxUrl : null;

  // Build fallback blob preview HTML — always compute if htmlFile exists
  // (don't gate on useBlobPreview so it's ready immediately when needed)
  const previewHtml = useMemo(() => {
    if (!htmlFile) return null;

    let indexHtml = files.get(htmlFile) || '';
    if (!indexHtml) return null;

    let html = indexHtml;

    // Inline CSS files
    const cssFiles = Array.from(files.entries()).filter(([path]) => path.endsWith('.css'));
    for (const [path, content] of cssFiles) {
      const linkRegex = new RegExp(
        `<link[^>]*href=["'](?:\\.?\\/?)${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split('/').pop()!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
        'gi'
      );
      html = html.replace(linkRegex, `<style>/* ${path} */\n${content}\n</style>`);
    }

    // Inline JS files
    const jsFiles = Array.from(files.entries()).filter(([path]) => path.endsWith('.js') || path.endsWith('.mjs'));
    for (const [path, content] of jsFiles) {
      const scriptRegex = new RegExp(
        `<script[^>]*src=["'](?:\\.?\\/?)${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split('/').pop()!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>\\s*</script>`,
        'gi'
      );
      html = html.replace(scriptRegex, `<script>/* ${path} */\n${content}\n</script>`);
    }

    return html;
  }, [files, htmlFile]);

  // Auto-refresh blob preview with debounce
  // Also handles initial load — when iframe ref becomes available
  useEffect(() => {
    if (!useBlobPreview || !autoRefresh || !previewHtml) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (iframeRef.current && previewHtml) {
        const blob = new Blob([previewHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        iframeRef.current.src = url;
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    }, 100); // Reduced from 500ms to 100ms for faster initial render

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [previewHtml, autoRefresh, useBlobPreview]);

  const refreshPreview = useCallback(() => {
    if (previewUrl) {
      setRefreshKey(k => k + 1);
    } else if (iframeRef.current && previewHtml) {
      const blob = new Blob([previewHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      iframeRef.current.src = url;
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }, [previewHtml, previewUrl]);

  const openInNewTab = useCallback(() => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    } else if (previewHtml) {
      const blob = new Blob([previewHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }, [previewHtml, previewUrl]);

  const hasPreview = !!previewUrl || useBlobPreview;
  const isBooting = !hasHtml && !webcontainerReady && sandboxStatus === 'creating';

  return (
    <div className={clsx(
      'flex flex-col h-full bg-white',
      fullscreen && 'fixed inset-0 z-50',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-slate-200 bg-slate-50 shrink-0">
        <span className="text-xs font-semibold text-slate-600">
          Preview
          {useWebcontainer && (
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs bg-green-100 text-green-700 font-medium">
              <Zap size={9} className="mr-0.5" />
              Instant
            </span>
          )}
          {useSandbox && (
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs bg-blue-100 text-blue-700 font-medium">
              Sandbox
            </span>
          )}
          {useBlobPreview && (
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs bg-slate-100 text-slate-600 font-medium">
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

          {hasPreview && (
            <>
              <button onClick={refreshPreview} className="p-1 rounded hover:bg-slate-200 text-slate-500 transition-colors" title="Refresh">
                <RefreshCw size={12} />
              </button>
              <button onClick={openInNewTab} className="p-1 rounded hover:bg-slate-200 text-slate-500 transition-colors" title="Open in new tab">
                <ExternalLink size={12} />
              </button>
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
        {/* Booting state */}
        {isBooting && (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center">
              <Loader2 size={20} className="text-brand-500 animate-spin" />
            </div>
            <p className="text-sm font-medium text-slate-700">Getting ready...</p>
            <p className="text-xs text-slate-500">
              Setting up your development environment
            </p>
          </div>
        )}

        {/* WebContainer or Sandbox iframe */}
        {previewUrl && (
          <div
            className="h-full bg-white shadow-lg transition-all duration-200"
            style={{ width: deviceWidths[device], maxWidth: '100%' }}
          >
            <iframe
              key={refreshKey}
              src={previewUrl}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              title="Preview"
            />
          </div>
        )}

        {/* Blob fallback */}
        {useBlobPreview && previewHtml && (
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
        {!previewUrl && !useBlobPreview && !isBooting && (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-slate-200 flex items-center justify-center">
              <Monitor size={20} className="text-slate-400" />
            </div>
            <p className="text-xs text-slate-500">
              Ask the AI to build something — the preview will appear here instantly
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
