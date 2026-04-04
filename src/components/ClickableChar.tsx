import { useNavigationStore } from '../stores/navigationStore';
import { db } from '../db/db';

interface ClickableCharProps {
  char: string;
  /** If we already know the meaning ID, pass it directly */
  meaningId?: string;
  className?: string;
}

/**
 * A single clickable Chinese character.
 * Clicking opens its meaning card. If meaningId matches the current view,
 * it's a no-op (stays in place) but still looks clickable for consistency.
 */
export function ClickableChar({ char, meaningId, className = '' }: ClickableCharProps) {
  const { push, open, isOpen, current } = useNavigationStore();

  const handleClick = async () => {
    let id = meaningId;

    if (!id) {
      const meaning = await db.meanings
        .where('headword')
        .equals(char)
        .first();
      if (meaning) id = meaning.id;
    }

    if (!id) return;

    // Already viewing this meaning — no-op
    const cur = current();
    if (cur && cur.type === 'meaning' && cur.id === id) return;

    if (isOpen) {
      push({ type: 'meaning', id });
    } else {
      open({ type: 'meaning', id });
    }
  };

  return (
    <span
      onClick={handleClick}
      className={`cursor-pointer hover:bg-blue-100 rounded transition-colors ${className}`}
      title={`View meaning of ${char}`}
    >
      {char}
    </span>
  );
}
