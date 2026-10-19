'use client';

import React from 'react';
import { useUIStore } from '@/lib/store/use-ui-store';
import { MaterialIcon } from './material-icon';

export function GlobalToast() {
  const { toast, hideToast } = useUIStore();

  if (!toast.isVisible) return null;

  const getIconName = () => {
    switch (toast.type) {
      case 'success':
        return 'check_circle';
      case 'error':
        return 'error';
      case 'info':
      default:
        return 'info';
    }
  };

  const getStyles = () => {
    switch (toast.type) {
      case 'success':
        return 'border-emerald-700/80 bg-[#121c17] text-emerald-100 shadow-emerald-950/20';
      case 'error':
        return 'border-red-700/80 bg-[#241311] text-red-100 shadow-red-950/20';
      case 'info':
      default:
        return 'border-zinc-700/80 bg-[#18181b] text-zinc-100 shadow-zinc-950/20';
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-full border shadow-xl text-xs sm:text-sm font-medium transition-all duration-300 pointer-events-auto ${getStyles()}`}
    >
      <MaterialIcon
        name={getIconName()}
        size={18}
        className={toast.type === 'error' ? 'text-red-400' : 'text-emerald-400'}
      />
      <span>{toast.message}</span>
      <button
        onClick={hideToast}
        className="ml-1.5 p-0.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white cursor-pointer focus-visible:ring-1 focus-visible:ring-white focus-visible:outline-none"
        aria-label="Dismiss notification"
      >
        <MaterialIcon name="close" size={14} />
      </button>
    </div>
  );
}
