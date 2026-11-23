/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canApplySafeAppUpdate,
  computePWAInstallMode,
  detectPWAPlatform,
  shouldBypassServiceWorkerCache,
} from './pwaInstall';

test('detectPWAPlatform accurately distinguishes Android, iOS, and Desktop UAs', () => {
  const androidChrome =
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const iosSafari =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const desktopChrome =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

  assert.deepEqual(detectPWAPlatform(androidChrome), {
    isIOS: false,
    isAndroid: true,
    isDesktop: false,
  });
  assert.deepEqual(detectPWAPlatform(iosSafari), {
    isIOS: true,
    isAndroid: false,
    isDesktop: false,
  });
  assert.deepEqual(detectPWAPlatform(desktopChrome), {
    isIOS: false,
    isAndroid: false,
    isDesktop: true,
  });
});

test('computePWAInstallMode prioritizes installed > native prompt > platform manual guide', () => {
  const android = detectPWAPlatform('Android Chrome');
  const ios = detectPWAPlatform('iPhone Safari');
  const desktop = detectPWAPlatform('Linux Chrome');

  assert.equal(
    computePWAInstallMode({
      isInstalled: true,
      hasDeferredPrompt: true,
      platform: android,
    }),
    'installed'
  );
  assert.equal(
    computePWAInstallMode({
      isInstalled: false,
      hasDeferredPrompt: true,
      platform: android,
    }),
    'native'
  );
  assert.equal(
    computePWAInstallMode({
      isInstalled: false,
      hasDeferredPrompt: false,
      platform: android,
    }),
    'android_manual'
  );
  assert.equal(
    computePWAInstallMode({
      isInstalled: false,
      hasDeferredPrompt: false,
      platform: ios,
    }),
    'ios_manual'
  );
  assert.equal(
    computePWAInstallMode({
      isInstalled: false,
      hasDeferredPrompt: false,
      platform: desktop,
    }),
    'desktop_manual'
  );
});

test('canApplySafeAppUpdate blocks updates while sales, purchases, or entries are active', () => {
  const blocked = canApplySafeAppUpdate({
    swUpdateAvailable: true,
    swUpdating: false,
    activeTransactionKeys: new Set(['quick-sale']),
  });
  assert.equal(blocked.canApplyNow, false);
  assert.equal(blocked.activeCount, 1);
  assert.match(blocked.blockedReason || '', /Finish your active sale/i);

  const allowed = canApplySafeAppUpdate({
    swUpdateAvailable: true,
    swUpdating: false,
    activeTransactionKeys: new Set(),
  });
  assert.equal(allowed.canApplyNow, true);
  assert.equal(allowed.blockedReason, null);
  assert.equal(allowed.activeCount, 0);
});

test('shouldBypassServiceWorkerCache protects auth, private APIs, Firebase, and WhatsApp endpoints', () => {
  assert.equal(shouldBypassServiceWorkerCache('/api/auth/session'), true);
  assert.equal(shouldBypassServiceWorkerCache('/api/whatsapp/batch/send'), true);
  assert.equal(
    shouldBypassServiceWorkerCache('https://my-app.example.com/api/extract-suppliers'),
    true
  );
  assert.equal(
    shouldBypassServiceWorkerCache('https://identitytoolkit.googleapis.com/v1/accounts:lookup'),
    true
  );
  assert.equal(
    shouldBypassServiceWorkerCache('https://firebasestorage.googleapis.com/v0/b/bucket/o'),
    true
  );
  assert.equal(
    shouldBypassServiceWorkerCache('https://graph.facebook.com/v19.0/123/messages'),
    true
  );

  // Static local app shell files remain cacheable
  assert.equal(shouldBypassServiceWorkerCache('/index.html'), false);
  assert.equal(shouldBypassServiceWorkerCache('/offline.html'), false);
  assert.equal(shouldBypassServiceWorkerCache('/pwa-192x192.png'), false);
  assert.equal(shouldBypassServiceWorkerCache('/assets/index-abc123.js'), false);
});
