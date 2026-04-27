/**
 * PWA install plumbing — platform detection, deferred-prompt capture,
 * and a small subscribe API the UI uses to react to install state.
 *
 * Chrome fires `beforeinstallprompt` very early in page lifecycle, so an
 * inline script in index.html attaches the listener at parse time and
 * stashes the captured event on `window.__pwaInstall`. Module code reads
 * from there; no race with React boot.
 */
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PwaInstallGlobal {
  deferred: BeforeInstallPromptEvent | null;
  installed: boolean;
}

declare global {
  interface Window {
    __pwaInstall?: PwaInstallGlobal;
  }
}

export type Platform =
  /** Already running as an installed PWA — no install UI needed. */
  | 'installed'
  /** Chromium-family browser that fired beforeinstallprompt — show real Install button. */
  | 'promptable'
  /** Chromium desktop browser where the site IS installable (manifest + SW
   *  passed Chrome's checks, so the install icon shows in the address bar)
   *  but the prompt event hasn't fired — typically because the user
   *  recently installed/uninstalled and Chrome is in cooldown. We fall back
   *  to pointing at the address-bar icon. */
  | 'chrome-address-bar'
  /** iOS Safari (or any iOS browser, since they're all WebKit) — show "Share → Add to Home Screen". */
  | 'ios-safari'
  /** macOS Safari 14+ — show "File → Add to Dock". */
  | 'macos-safari'
  /** Firefox / in-app browsers / anything else — no install path; hide UI. */
  | 'no-install';

const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch (e) { console.error('pwaInstall listener error', e); }
  }
}

function getDeferred(): BeforeInstallPromptEvent | null {
  return (typeof window !== 'undefined' && window.__pwaInstall?.deferred) || null;
}

function isInstalled(): boolean {
  return typeof window !== 'undefined' && window.__pwaInstall?.installed === true;
}

if (typeof window !== 'undefined') {
  // Inline script dispatches '__pwa_state_changed' whenever __pwaInstall
  // mutates. Re-emit to subscribers so the React UI re-renders.
  window.addEventListener('__pwa_state_changed', notify);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // navigator.standalone is the iOS-only legacy flag for home-screen apps.
  const navAny = navigator as Navigator & { standalone?: boolean };
  if (navAny.standalone === true) return true;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return false;
}

const DEV_OVERRIDE_KEY = 'mandao_pwa_dev_platform';
const VALID_PLATFORMS: Platform[] = ['installed', 'promptable', 'chrome-address-bar', 'ios-safari', 'macos-safari', 'no-install'];

// Run once at module load: a `?pwa=ios-safari` URL pins a platform for the
// session via sessionStorage so it survives client-side nav. `?pwa=` clears.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const fromUrl = new URLSearchParams(window.location.search).get('pwa');
  if (fromUrl !== null) {
    if (fromUrl === '') sessionStorage.removeItem(DEV_OVERRIDE_KEY);
    else if (VALID_PLATFORMS.includes(fromUrl as Platform)) sessionStorage.setItem(DEV_OVERRIDE_KEY, fromUrl);
  }
}

function devPlatformOverride(): Platform | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const stored = sessionStorage.getItem(DEV_OVERRIDE_KEY);
  return stored && VALID_PLATFORMS.includes(stored as Platform) ? (stored as Platform) : null;
}

/** Best-effort UA-based detection. iOS is unavoidable here because Apple
 *  doesn't expose `beforeinstallprompt`. Used only to pick which copy to
 *  show; nothing security-sensitive depends on it. */
export function getPlatform(): Platform {
  const override = devPlatformOverride();
  if (override) return override;
  if (typeof window === 'undefined') return 'no-install';
  if (isInstalled() || isStandalone()) return 'installed';
  if (getDeferred()) return 'promptable';

  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac. The touch sniff is the standard workaround.
  const isIOS =
    /iPhone|iPad|iPod/.test(ua) ||
    (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
  // All iOS browsers use WebKit, but in-app browsers (Instagram, Twitter,
  // etc.) don't have a Share menu users can install from — hide rather
  // than mislead.
  const isInAppBrowser = /(FBAN|FBAV|Instagram|Twitter|Line|WeChat)/i.test(ua);
  if (isIOS && !isInAppBrowser) return 'ios-safari';

  // Desktop Safari 14+ supports install via File → Add to Dock but doesn't
  // expose the prompt event. Detect by Safari + Mac, no iOS.
  const isSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS|FxiOS|EdgiOS/.test(ua);
  const isMac = ua.includes('Mac OS X') || ua.includes('Macintosh');
  if (isSafari && isMac) return 'macos-safari';

  // Chromium desktop fallback. The site is installable (Chrome shows the
  // address-bar install icon) but `beforeinstallprompt` never fired —
  // common after install/uninstall cycles where Chrome cooldowns the
  // prompt event. Direct the user to the icon they're already seeing.
  const isChromiumDesktop =
    !/Android|iPhone|iPad|iPod/.test(ua) &&
    /Chrome\/|Chromium\/|Edg\//.test(ua);
  if (isChromiumDesktop) return 'chrome-address-bar';

  return 'no-install';
}

export function subscribeInstallState(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook: subscribes to platform / install-state changes and re-renders. */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState(getPlatform);
  useEffect(() => subscribeInstallState(() => setPlatform(getPlatform())), []);
  return platform;
}

/** Dev-only: simulate an accepted install when forced into 'promptable'
 *  via the URL override. Lets QA exercise the post-install UX without a
 *  real installable manifest. Stripped from prod via import.meta.env.DEV. */
function fakeDevInstall(): boolean {
  if (!import.meta.env.DEV) return false;
  if (devPlatformOverride() !== 'promptable') return false;
  sessionStorage.setItem(DEV_OVERRIDE_KEY, 'installed');
  if (window.__pwaInstall) window.__pwaInstall.installed = true;
  notify();
  return true;
}

/** Trigger the native install prompt. Only works on `promptable` platform.
 *  Resolves with the user's choice, or 'unavailable' if there's no prompt. */
export async function triggerInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = getDeferred();
  if (!prompt) return fakeDevInstall() ? 'accepted' : 'unavailable';
  // Per the spec, the deferred event can only be prompted once; clear it
  // either way so the UI reflects the new state.
  if (window.__pwaInstall) window.__pwaInstall.deferred = null;
  notify();
  try {
    await prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === 'accepted') {
      // appinstalled fires too, but flip eagerly so the UI updates immediately.
      if (window.__pwaInstall) window.__pwaInstall.installed = true;
      notify();
    }
    return result.outcome;
  } catch {
    return 'dismissed';
  }
}
