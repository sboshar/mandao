/**
 * PWA auto-update bootstrap.
 *
 * Default vite-plugin-pwa registration only runs the SW update check on a
 * real page load. Installed PWAs typically resume from background, so a
 * fresh deploy on Vercel never gets picked up until the user fully quits
 * the app. This module forces the check on visibility/focus and on a
 * periodic poll, then auto-reloads the page once the new SW takes
 * control — yielding "open the app, brief flicker, new version" UX with
 * no prompt.
 */
import { registerSW } from 'virtual:pwa-register';

const POLL_INTERVAL_MS = 60 * 60 * 1000;

export function initPwaAutoUpdate(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // controllerchange fires when the new SW takes over the page (skipWaiting
  // + clientsClaim, both default with registerType:'autoUpdate'). Reload
  // once so the running JS matches the now-active SW's precache.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdate = () => {
        registration.update().catch(() => {
          // Offline or transient network error — silently retry on next trigger.
        });
      };

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
      window.addEventListener('focus', checkForUpdate);
      window.setInterval(checkForUpdate, POLL_INTERVAL_MS);
    },
  });
}
