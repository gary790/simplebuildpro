// ============================================================
// SimpleBuild Pro — Preview Panel
// Isolated preview via Novita sandbox with iframe
// ============================================================

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useEditorStore } from '@/lib/store';
import { previewApi } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  Play, Square, RefreshCw, ExternalLink, Maximize2, Minimize2,
  Monitor, Smartphone, Tablet, Loader2, AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

const deviceWidths: Record<DeviceMode, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

export function PreviewPanel() {
  const {
    project, previewSession, setPreviewSession,
    previewLoading, setPreviewLoading, files,
  } = useEditorStore();

  const [device, setDevice] = useState<DeviceMode>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const refreshKeyRef = useRef(0);

  const startPreview = useCallback(async () => {
    if (!project?.id) return;
    setPreviewLoading(true);
    setError(null);

    try {
      const session = await previewApi.start(project.id);
      setPreviewSession(session as any);
      toast('success', 'Preview started', session.reused ? 'Reusing existing sandbox.' : 'New sandbox created.');
    } catch (err: any) {
      setError(err.message || 'Failed to start preview.');
      toast('error', 'Preview failed', err.message);
    } finally {
      setPreviewLoading(false);
    }
  }, [project?.id, setPreviewSession, setPreviewLoading]);

  const stopPreview = useCallback(async () => {
    if (!previewSession) return;
    try {
      await previewApi.stop((previewSession as any).sessionId || (previewSession as any).id);
      setPreviewSession(null);
      toast('info', 'Preview stopped');
    } catch {
      // Ignore
    }
  }, [previewSession, setPreviewSession]);

  const refreshPreview = useCallback(async () => {
    if (!previewSession) return;

    // Hot-reload files to sandbox
    const fileMap: Record<string, string> = {};
    files.forEach((content, path) => {
      fileMap[path] = content;
    });

    try {
      await previewApi.update(
        (previewSession as any).sessionId || (previewSession as any).id,
        fileMap,
      );
      // Force iframe reload
      refreshKeyRef.current += 1;
      if (iframeRef.current) {
        iframeRef.current.src = iframeRef.current.src;
      }
    } catch (err: any) {
      toast('error', 'Update failed', err.message);
    }
  }, [previewSession, files]);

  const previewUrl = (previewSession as any)?.previewUrl || (previewSession as any)?.url || null;

  return (
    <div className={clsx(
      'flex flex-col h-full bg-white border-l border-slate-200',
      fullscreen && 'fixed inset-0 z-50',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-slate-200 bg-slate-50 shrink-0">
        <span className="text-xs font-semibold text-slate-600">Preview</span>
        <div className="flex items-center gap-1">
          {/* Device Toggle */}
          {previewUrl && (
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
          {!previewSession ? (
            <Button size="xs" onClick={startPreview} loading={previewLoading} icon={<Play size={10} />}>
              Start
            </Button>
          ) : (
            <>
              <button onClick={refreshPreview} className="p-1 rounded hover:bg-slate-200 text-slate-500 transition-colors" title="Refresh">
                <RefreshCw size={12} />
              </button>
              <button onClick={stopPreview} className="p-1 rounded hover:bg-slate-200 text-red-500 transition-colors" title="Stop">
                <Square size={12} />
              </button>
              {previewUrl && (
                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-slate-200 text-slate-500 transition-colors" title="Open in new tab">
                  <ExternalLink size={12} />
                </a>
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
        {previewLoading && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={24} className="animate-spin text-brand-600" />
            <p className="text-xs text-slate-500">Starting preview sandbox...</p>
          </div>
        )}

        {error && !previewLoading && (
          <div className="flex flex-col items-center gap-3 max-w-xs text-center">
            <AlertCircle size={24} className="text-red-400" />
            <p className="text-xs text-red-600">{error}</p>
            <Button size="xs" variant="outline" onClick={startPreview}>Retry</Button>
          </div>
        )}

        {!previewSession && !previewLoading && !error && (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-200 flex items-center justify-center">
              <Monitor size={20} className="text-slate-400" />
            </div>
            <p className="text-xs text-slate-500">Click Start to launch a live preview</p>
            <Button size="xs" onClick={startPreview} icon={<Play size={10} />}>
              Start Preview
            </Button>
          </div>
        )}

        {previewUrl && !previewLoading && (
          <div
            className="h-full bg-white shadow-lg transition-all duration-200"
            style={{ width: deviceWidths[device], maxWidth: '100%' }}
          >
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              title="Preview"
            />
          </div>
        )}
      </div>
    </div>
  );
}
