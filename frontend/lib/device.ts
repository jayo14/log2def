/**
 * Device and Platform Detection utilities for PWA installation & responsive UX
 */

export type DeviceOS = 'ios' | 'android' | 'pc';

export interface DeviceInfo {
  os: DeviceOS;
  isStandalone: boolean;
  browser: 'safari' | 'chrome' | 'edge' | 'firefox' | 'other';
}

export function detectDeviceOS(): DeviceOS {
  if (typeof window === 'undefined') return 'pc';
  const ua = window.navigator.userAgent || '';
  const platform =
    (window.navigator as any).userAgentData?.platform ||
    (window.navigator as any).platform ||
    '';

  // iOS check (iPhone, iPad, iPod, or iPadOS 13+ masquerading as Macintosh with multi-touch)
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh|MacIntel/.test(platform) && window.navigator.maxTouchPoints > 1);

  if (isIOS) return 'ios';

  // Android check
  if (/Android/i.test(ua)) return 'android';

  // PC / Desktop (Windows, macOS, Linux, ChromeOS)
  return 'pc';
}

export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.startsWith('android-app://') ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('pwa_installed') === 'true')
  );
}

export function detectBrowser(): 'safari' | 'chrome' | 'edge' | 'firefox' | 'other' {
  if (typeof window === 'undefined') return 'other';
  const ua = window.navigator.userAgent || '';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/Chrome|CriOS/i.test(ua)) return 'chrome';
  if (/Safari/i.test(ua) && !/Chrome|CriOS/i.test(ua)) return 'safari';
  return 'other';
}

export function getDeviceInfo(): DeviceInfo {
  return {
    os: detectDeviceOS(),
    isStandalone: isStandaloneApp(),
    browser: detectBrowser(),
  };
}
