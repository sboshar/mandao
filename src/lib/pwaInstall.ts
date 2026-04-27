/**
 * PWA install plumbing — platform detection, deferred-prompt capture,
 * and a small subscribe API the UI uses to react to install state.
 *
 * The `beforeinstallprompt` event fires once, early in the page lifecycle,
 * and is the only way to programmatically trigger install on Chromium
 * browsers. Capturing it requires a listener in place *before* the event
 * fires — so this module attaches its handler at import time, not from a
 * React effect. Import this module from main.tsx (or App.tsx) so that
 * happens during boot.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type Platform =
  /** Already running as an installed PWA — no install UI needed. */
  | 'installed'
  /** Chromium-family browser that fired beforeinstallprompt — show real Install button. */
  | 'promptable'
  /** iOS Safari (or any iOS browser, since they're all WebKit) — show "Share → Add to Home Screen". */
  | 'ios-safari'
  /** macOS Safari 14+ — show "File → Add to Dock". */
  | 'macos-safari'
  /** Firefox / in-app browsers / anything else — no install path; hide UI. */
  | 'no-install';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch (e) { console.error('pwaInstall listener error', e); }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Stops Chrome from showing its own mini-infobar so we can drive the UX.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    notify();
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // navigator.standalone is the iOS-only legacy flag for home-screen apps.
  const navAny = navigator as Navigator & { standalone?: boolean };
  if (navAny.standalone === true) return true;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  return false;
}

/** Best-effort UA-based detection. iOS is unavoidable here because Apple
 *  doesn't expose `beforeinstallprompt`. Used only to pick which copy to
 *  show; nothing security-sensitive depends on it. */
export function getPlatform(): Platform {
  if (typeof window === 'undefined') return 'no-install';
  if (installed || isStandalone()) return 'installed';
  if (deferredPrompt) return 'promptable';

  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac. The touch sniff is the standard workaround.
  const isIOS =
    /iPhone|iPad|iPod/.test(ua) ||
    (ua.includes('Mac') && typeof document !== 'undefined' && 'ontouchend' in document);
  // All iOS browsers use WebKit, but we only show the Add-to-Home-Screen
  // copy when the user is in a context where Share works. In-app browsers
  // (Instagram, Twitter, etc.) don't have a Share menu they can install
  // from — best to hide rather than mislead.
  const isInAppBrowser = /(FBAN|FBAV|Instagram|Twitter|Line|WeChat)/i.test(ua);
  if (isIOS && !isInAppBrowser) return 'ios-safari';

  // Desktop Safari 14+ supports install via File → Add to Dock but doesn't
  // expose the prompt event. Detect by Safari + Mac, no iOS.
  const isSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS|FxiOS|EdgiOS/.test(ua);
  const isMac = ua.includes('Mac OS X') || ua.includes('Macintosh');
  if (isSafari && isMac) return 'macos-safari';

  // Anything else: not promptable (yet), no instructions to give.
  return 'no-install';
}

/** Subscribe to platform / install-state changes. Fires when the deferred
 *  prompt becomes available or the app gets installed. Returns an
 *  unsubscribe function. */
export function subscribeInstallState(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Trigger the native install prompt. Only works on `promptable` platform.
 *  Resolves with the user's choice, or 'unavailable' if there's no prompt. */
export async function triggerInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt;
  // Per the spec, the deferred event can only be prompted once; clear it
  // either way so the UI reflects the new state.
  deferredPrompt = null;
  notify();
  try {
    await prompt.prompt();
    const result = await prompt.userChoice;
    if (result.outcome === 'accepted') {
      // appinstalled will also fire and flip `installed`, but set it eagerly
      // so the UI updates without waiting for the second event.
      installed = true;
      notify();
    }
    return result.outcome;
  } catch {
    return 'dismissed';
  }
}
