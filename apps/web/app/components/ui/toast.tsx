// ============================================================
// SimpleBuild Pro — Toast Notifications
// ============================================================

'use client';

import { create } from 'zustand';
import { useEffect } from 'react';
import clsx from 'clsx';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  add: (toast: Omit<Toast, 'id'>) => void;
  remove: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  add: (toast) => {
    const id = Math.random().toString(36).slice(2, 9);
    set({ toasts: [...get().toasts, { ...toast, id }] });
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, toast.duration || 4000);
  },
  remove: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export function toast(type: ToastType, title: string, message?: string) {
  useToastStore.getState().add({ type, title, message });
}

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={18} className="text-green-500" />,
  error: <XCircle size={18} className="text-red-500" />,
  warning: <AlertTriangle size={18} className="text-amber-500" />,
  info: <Info size={18} className="text-blue-500" />,
};

const borderColors: Record<ToastType, string> = {
  success: 'border-l-green-500',
  error: 'border-l-red-500',
  warning: 'border-l-amber-500',
  info: 'border-l-blue-500',
};

function ToastItem({ toast: t }: { toast: Toast }) {
  const remove = useToastStore((s) => s.remove);

  return (
    <div
      className={clsx(
        'flex items-start gap-3 bg-white rounded-lg shadow-lg border border-slate-200 border-l-4 p-4 min-w-[320px] max-w-[420px] animate-slide-up',
        borderColors[t.type],
      )}
    >
      <span className="mt-0.5 shrink-0">{icons[t.type]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900">{t.title}</p>
        {t.message && <p className="text-xs text-slate-500 mt-0.5">{t.message}</p>}
      </div>
      <button
        onClick={() => remove(t.id)}
        className="p-0.5 rounded text-slate-400 hover:text-slate-600 transition-colors shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
