import { useEffect, useState } from 'react';
import { triggerInstall, usePlatform, type Platform } from '../lib/pwaInstall';
import { useInstallNudgeStore } from '../stores/installNudgeStore';

const HINT_TIMEOUT_MS = 5000;

export function InstallBanner() {
  const platform = usePlatform();
  const dismissedAt = useInstallNudgeStore((s) => s.dismissedAt);
  const dismiss = useInstallNudgeStore((s) => s.dismiss);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (!showHint) return;
    const t = setTimeout(() => setShowHint(false), HINT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [showHint]);

  if (platform === 'installed' || platform === 'no-install') return null;
  // Permanently dismissed — but render the hint window if a dismiss just happened.
  if (dismissedAt !== null && !showHint) return null;

  const handleDismiss = () => {
    dismiss();
    setShowHint(true);
  };

  const handleInstallClick = async () => {
    const outcome = await triggerInstall();
    // Either way (accepted, dismissed by user, or no longer available),
    // the user has made their choice — don't keep nagging them.
    if (outcome === 'accepted') {
      // appinstalled will flip the platform to 'installed' and the banner
      // will return null on next render. Skip the hint — they don't need
      // the "find it in Settings" tip.
      dismiss();
    } else {
      handleDismiss();
    }
  };

  if (showHint) {
    return (
      <div
        className="sticky top-0 z-40 px-4 py-2 text-xs"
        style={{
          background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-surface))',
          borderBottom: '1px solid var(--border)',
          color: 'var(--text-secondary)',
        }}
        role="status"
      >
        You can install Mandao later from <strong>Settings → Data</strong>.
      </div>
    );
  }

  return (
    <div
      className="sticky top-0 z-40 px-4 py-2 text-xs"
      style={{
        background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-surface))',
        borderBottom: '1px solid var(--border)',
        color: 'var(--text-primary)',
      }}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <BannerCopy platform={platform} />
        <div className="flex gap-2 ml-auto">
          {platform === 'promptable' && (
            <button
              type="button"
              onClick={handleInstallClick}
              className="px-2.5 py-1 rounded font-medium transition-colors"
              style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
            >
              Install
            </button>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            className="px-2.5 py-1 rounded transition-colors"
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            {platform === 'promptable' ? 'Not now' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}

const InstallIconSvg = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ display: 'inline-block', verticalAlign: '-2px' }}
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

function BannerCopy({ platform }: { platform: Platform }) {
  if (platform === 'promptable') {
    return (
      <span>
        <strong>Install Mandao</strong> to keep your offline audio cache from being evicted by the browser.
      </span>
    );
  }
  if (platform === 'chrome-address-bar') {
    return (
      <span>
        <strong>Install Mandao</strong> for a smoother offline experience: click the install icon{' '}
        {InstallIconSvg} in your address bar.
      </span>
    );
  }
  if (platform === 'ios-safari') {
    return (
      <span>
        <strong>Install Mandao</strong> so your offline audio survives between sessions: tap{' '}
        <strong>Share</strong> → <strong>Add to Home Screen</strong>.
      </span>
    );
  }
  if (platform === 'macos-safari') {
    return (
      <span>
        <strong>Install Mandao</strong> for a smoother offline experience: in Safari's menu bar, choose{' '}
        <strong>File</strong> → <strong>Add to Dock</strong>.
      </span>
    );
  }
  return null;
}
