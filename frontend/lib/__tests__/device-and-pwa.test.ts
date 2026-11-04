import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectDeviceOS, isStandaloneApp } from '../device.ts';

describe('Log2Def Device & OS-Aware PWA Installation Tests', () => {
  it('detects iOS user agent strings correctly', () => {
    const iPhoneUA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    assert.equal(detectDeviceOS(iPhoneUA), 'ios');

    const iPadUA =
      'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    assert.equal(detectDeviceOS(iPadUA), 'ios');
  });

  it('detects Android user agent strings correctly', () => {
    const androidChromeUA =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.105 Mobile Safari/537.36';
    assert.equal(detectDeviceOS(androidChromeUA), 'android');

    const samsungUA =
      'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.5790.166 Mobile Safari/537.36';
    assert.equal(detectDeviceOS(samsungUA), 'android');
  });

  it('detects PC / Desktop user agent strings correctly', () => {
    const macChromeUA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    assert.equal(detectDeviceOS(macChromeUA), 'pc');

    const windowsUA =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    assert.equal(detectDeviceOS(windowsUA), 'pc');
  });

  it('handles server-side environments safely without crashing', () => {
    assert.equal(isStandaloneApp(), false);
  });
});
