'use client';

import { useEffect, useState } from 'react';
import { useUIStore } from '@/lib/store/use-ui-store';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function PWAManager() {
  const { showToast } = useUIStore();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // 1. Detect if running as installed standalone PWA
    const checkStandalone = () => {
      const isStandaloneMode =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);
    };
    checkStandalone();

    // 2. Register Service Worker in production / client
    if ('serviceWorker' in navigator && typeof window !== 'undefined') {
      window.addEventListener('load', async () => {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js', {
            scope: '/',
          });

          // Check for service worker updates periodically
          registration.addEventListener('updatefound', () => {
            const installingWorker = registration.installing;
            if (installingWorker) {
              installingWorker.addEventListener('statechange', () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  showToast('Log2Def has been updated. Refresh to apply latest version.', 'info');
                }
              });
            }
          });
        } catch (error) {
          console.warn('Service Worker registration skipped or unavailable:', error);
        }
      });
    }

    // 3. Online/Offline Network Status Listeners
    const handleOnline = () => {
      document.body.classList.remove('is-offline');
      showToast('Back online! Connected to cloud AI.', 'success');
    };

    const handleOffline = () => {
      document.body.classList.add('is-offline');
      showToast('You are offline. Cached logbooks and report drafts remain accessible.', 'info');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 4. Capture PWA Install Prompt Event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
      // Expose to window for UI buttons
      (window as any).__pwaInstallPrompt = e;
      window.dispatchEvent(new CustomEvent('pwa-installable'));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstallable(false);
      showToast('Log2Def installed successfully!', 'success');
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [showToast]);

  return null;
}
