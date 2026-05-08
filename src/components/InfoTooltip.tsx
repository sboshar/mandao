interface Props {
  help: string;
}

/**
 * Small info icon with a CSS-driven hover popover. Used over the native
 * `title=` pattern when the help text is multi-sentence and the long
 * native-tooltip delay feels sluggish. Touch devices won't see the popover
 * (no hover); they fall through to the icon's silent presence.
 */
export function InfoTooltip({ help }: Props) {
  return (
    <span
      className="relative inline-flex group"
      // The icon sits inside a parent <label>, where any click would toggle
      // the associated radio. Block the label-default and bubbling.
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        aria-hidden="true"
        style={{ color: 'var(--text-tertiary)', cursor: 'default' }}
      >
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="8" cy="4.5" r="0.9" fill="currentColor" />
        <rect x="7.25" y="6.5" width="1.5" height="5.5" rx="0.5" fill="currentColor" />
      </svg>
      <span
        role="tooltip"
        className="absolute z-10 hidden group-hover:block w-60 p-2 rounded-md text-xs leading-snug"
        style={{
          right: 0,
          top: '100%',
          marginTop: '6px',
          background: 'var(--bg-elevated, var(--bg-surface))',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-strong)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}
      >
        {help}
      </span>
    </span>
  );
}
