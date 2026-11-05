'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useUIStore } from '@/lib/store/use-ui-store';

export function OfflineOverlay() {
  const { showToast } = useUIStore();
  const [isOffline, setIsOffline] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [restored, setRestored] = useState(false);

  const checkHealth = useCallback(async (): Promise<boolean> => {
    if (!navigator.onLine) return false;
    try {
      const res = await fetch('/api/health/', {
        cache: 'no-store',
        signal: AbortSignal.timeout(3500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const handleOnline = useCallback(async () => {
    setRestored(true);
    const reachable = await checkHealth();
    if (reachable) {
      showToast('Back online! Connected to cloud AI.', 'success');
      setTimeout(() => {
        setIsOffline(false);
        setRestored(false);
        setIsDismissed(false);
      }, 750);
    } else {
      setRestored(false);
    }
  }, [checkHealth, showToast]);

  const handleOffline = useCallback(() => {
    setIsOffline(true);
    setRestored(false);
    setIsDismissed(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!navigator.onLine) {
      setIsOffline(true);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  const handleRetry = async () => {
    setIsChecking(true);
    const reachable = await checkHealth();
    setIsChecking(false);

    if (reachable) {
      setRestored(true);
      showToast('Connection confirmed! Syncing with cloud AI...', 'success');
      setTimeout(() => {
        setIsOffline(false);
        setRestored(false);
        setIsDismissed(false);
      }, 600);
    } else {
      showToast('Still unable to reach cloud server. Waiting for network...', 'error');
    }
  };

  if (!isOffline || isDismissed) {
    return null;
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="offline-title"
      aria-describedby="offline-desc"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(3, 10, 7, 0.88)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        animation: 'fadeIn 0.25s ease-out',
      }}
    >
      <div
        style={{
          position: 'relative',
          background: 'rgba(14, 30, 24, 0.94)',
          border: '1px solid rgba(85, 214, 162, 0.28)',
          borderRadius: '28px',
          padding: '38px 28px 30px',
          maxWidth: '460px',
          width: '100%',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.75), 0 0 35px rgba(16, 185, 129, 0.12)',
          textAlign: 'center',
          color: '#f1f5f9',
          fontFamily: "'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {/* Logo and Offline Emblem */}
        <div
          style={{
            position: 'relative',
            width: '84px',
            height: '84px',
            margin: '0 auto 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '80px',
              height: '80px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '22px',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(5, 150, 105, 0.28) 100%)',
              border: '1.5px solid rgba(85, 214, 162, 0.45)',
              boxShadow: '0 12px 28px rgba(0, 0, 0, 0.4), 0 0 20px rgba(16, 185, 129, 0.2)',
            }}
          >
            <img
              src="/icons/icon-192.png"
              alt="Log2Def"
              style={{ width: '48px', height: '48px', objectFit: 'contain', borderRadius: '10px' }}
            />
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: '-3px',
              right: '-3px',
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: '#192b23',
              border: '2px solid #071712',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 8px rgba(0, 0, 0, 0.5)',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="#fbbf24"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
              <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
          </div>
        </div>

        {/* Offline Mode Status Chip */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 14px',
            background: 'rgba(245, 158, 11, 0.14)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            color: '#fbbf24',
            fontSize: '11.5px',
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            borderRadius: '999px',
            marginBottom: '14px',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#fbbf24',
              boxShadow: '0 0 8px #fbbf24',
              animation: 'pulse 1.8s infinite',
            }}
          />
          Offline Mode
        </div>

        <h1
          id="offline-title"
          style={{
            fontSize: '22px',
            fontWeight: 800,
            color: '#ffffff',
            margin: '0 0 10px',
            letterSpacing: '-0.02em',
          }}
        >
          No Internet Connection
        </h1>

        <p
          id="offline-desc"
          style={{
            fontSize: '14px',
            lineHeight: 1.6,
            color: '#94a3b8',
            margin: '0 0 20px',
          }}
        >
          You are currently disconnected. Your local logbook entries and cached report drafts remain safe on this device. Reconnect to sync with cloud AI.
        </p>

        {/* Safe local storage features */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            background: 'rgba(7, 23, 18, 0.65)',
            border: '1px solid rgba(85, 214, 162, 0.16)',
            borderRadius: '16px',
            padding: '12px 14px',
            marginBottom: '22px',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 600, color: '#cbd5e1' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Daily logbook entries safely cached</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 600, color: '#cbd5e1' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Report edits preserved in local memory</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', fontWeight: 600, color: '#cbd5e1' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Automatic cloud AI sync upon reconnecting</span>
          </div>
        </div>

        {/* Action: Retry Connection Button */}
        <button
          type="button"
          onClick={handleRetry}
          disabled={isChecking}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            width: '100%',
            padding: '14px 20px',
            background: restored
              ? 'linear-gradient(135deg, #34d399 0%, #10b981 100%)'
              : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: '#022013',
            border: 'none',
            borderRadius: '14px',
            fontSize: '15px',
            fontWeight: 800,
            cursor: isChecking ? 'not-allowed' : 'pointer',
            transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: '0 8px 22px rgba(16, 185, 129, 0.32)',
            opacity: isChecking ? 0.75 : 1,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              animation: isChecking ? 'spin 1s linear infinite' : 'none',
            }}
          >
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          <span>{isChecking ? 'Checking connection…' : restored ? 'Connected!' : 'Retry Connection'}</span>
        </button>

        {/* Dismiss / Browse offline button */}
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          style={{
            marginTop: '10px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            width: '100%',
            padding: '10px 16px',
            background: 'transparent',
            color: '#94a3b8',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            borderRadius: '12px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Continue viewing cached entries &amp; drafts
        </button>

        {/* Realtime listener status */}
        <div
          style={{
            marginTop: '16px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            fontSize: '12px',
            fontWeight: 600,
            color: restored ? '#34d399' : '#64748b',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: restored ? '#34d399' : '#64748b',
              boxShadow: restored ? '0 0 8px #34d399' : 'none',
            }}
          />
          <span>{restored ? 'Connection restored! Syncing…' : 'Listening for network reconnection...'}</span>
        </div>
      </div>
    </div>
  );
}
