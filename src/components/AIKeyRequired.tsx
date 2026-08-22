/**
 * Stand-in for an AI button when this device has no API key (#202).
 *
 * The features used to return null, which hid them completely. That reads as
 * "this app does not do that" rather than "you have not set this up" — and it is
 * especially confusing because the key lives in localStorage, so it is per
 * device: set it up on a laptop and the same account on a phone silently loses
 * every AI feature with nothing on screen to explain why.
 *
 * So the button stays, greyed, and says what is missing when pressed. A greyed
 * button advertises that the feature exists; null denies it.
 *
 * aria-disabled rather than disabled, deliberately: a disabled button fires no
 * click, and the click is the only way the explanation gets delivered. Screen
 * readers still hear that it is unavailable.
 */
import { useState } from 'react';
import { Link } from 'react-router';

export function AIKeyRequired({
  label,
  className = '',
  style,
  onNavigate,
}: {
  /** The same text the working button uses, so the feature stays recognizable. */
  label: string;
  className?: string;
  style?: React.CSSProperties;
  /** Lets a host close its modal before the Settings link routes away. */
  onNavigate?: () => void;
}) {
  const [asked, setAsked] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-disabled="true"
        onClick={() => setAsked(true)}
        className={className}
        style={{ ...style, opacity: 0.55 }}
        title="Needs an AI API key — add one in Settings"
      >
        {label}
      </button>
      {asked && (
        <span
          className="block w-full text-xs mt-1"
          style={{ color: 'var(--text-secondary)' }}
        >
          This needs an AI API key. Keys are stored on the device that entered
          them, so one added elsewhere will not show up here.{' '}
          <Link
            to="/settings"
            onClick={onNavigate}
            className="underline"
            style={{ color: 'var(--text-secondary)' }}
          >
            Open Settings
          </Link>
        </span>
      )}
    </>
  );
}
