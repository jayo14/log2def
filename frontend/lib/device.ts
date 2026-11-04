/**
 * Device and Platform Detection utilities for PWA installation & responsive UX
 */

export type DeviceOS = 'ios' | 'android' | 'pc';

export interface DeviceInfo {
  os: DeviceOS;
  isStandalone: boolean;
  browser: 'safari' | 'chrome' | 'edge' | 'firefox' | 'other';
}

export function detectDeviceOS(customUa?: string): DeviceOS {
  if (typeof window === 'undefined' && !customUa) return 'pc';
  const ua = customUa || (typeof window !== 'undefined' ? window.navigator.userAgent : '') || '';
  const platform =
    (typeof window !== 'undefined' &&
      ((window.navigator as any).userAgentData?.platform ||
        (window.navigator as any).platform)) ||
    '';

  // iOS check (iPhone, iPad, iPod, or iPadOS 13+ masquerading as Macintosh with multi-touch)
  const isIOS =
    /iPad|iPhone|iPod/i.test(ua) ||
    (/Macintosh|MacIntel/i.test(platform) &&
      typeof window !== 'undefined' &&
      window.navigator.maxTouchPoints > 1);

  if (isIOS) return 'ios';

  // Android check
  if (/Android/i.test(ua)) return 'android';

  // PC / Desktop (Windows, macOS, Linux, ChromeOS)
  return 'pc';
}

export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    Boolean((window.navigator as any)?.standalone === true) ||
    Boolean(typeof document !== 'undefined' && document.referrer?.startsWith('android-app://'))
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
