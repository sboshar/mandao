import { useState } from 'react';

interface Props {
  allTags: string[];
  selected: string[];
  onChange: (tags: string[]) => void;
  className?: string;
  allLabel?: string;
  chipSize?: 'sm' | 'md';
}

export function TagFilterRow({
  allTags,
  selected,
  onChange,
  className,
  allLabel = 'All',
  chipSize = 'sm',
}: Props) {
  const [open, setOpen] = useState(false);
  if (allTags.length === 0) return null;

  const toggle = (tag: string) =>
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);

  const chipPadding = chipSize === 'md' ? 'px-2.5 py-1' : 'px-2 py-0.5';

  return (
    <div className={className}>
      <button
        onClick={() => setOpen(!open)}
        className="text-xs px-2.5 py-1 rounded-full transition-colors"
        style={
          selected.length > 0
            ? { background: 'color-mix(in srgb, var(--accent) 15%, var(--bg-surface))', color: 'var(--accent)' }
            : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
        }
      >
        Filter by tag{selected.length > 0 ? ` (${selected.length})` : ''} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <button
            onClick={() => onChange([])}
            className={`${chipPadding} text-xs rounded-full transition-colors`}
            style={
              selected.length === 0
                ? { background: 'var(--text-primary)', color: 'var(--bg-surface)' }
                : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
            }
          >
            {allLabel}
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => toggle(tag)}
              className={`${chipPadding} text-xs rounded-full transition-colors`}
              style={
                selected.includes(tag)
                  ? { background: 'var(--accent)', color: 'var(--text-inverted)' }
                  : { background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-surface))', color: 'var(--accent)' }
              }
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
