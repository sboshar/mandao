import { useNavigationStore } from '../stores/navigationStore';

interface ClickableEnglishProps {
  text: string;
  className?: string;
}

/**
 * Renders English text with each word individually clickable.
 * Clicking a word opens the EnglishCard showing all Chinese meanings for it.
 * Punctuation and whitespace are rendered as-is (not clickable).
 */
export function ClickableEnglish({ text, className = '' }: ClickableEnglishProps) {
  const { push, open, isOpen } = useNavigationStore();

  // Split into words and non-word tokens (punctuation, spaces)
  const parts = text.match(/[a-zA-Z'-]+|[^a-zA-Z'-]+/g) || [];

  const handleClick = (word: string) => {
    // Strip leading/trailing punctuation for lookup
    const clean = word.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
    if (!clean) return;

    if (isOpen) {
      push({ type: 'english', id: clean.toLowerCase() });
    } else {
      open({ type: 'english', id: clean.toLowerCase() });
    }
  };

  return (
    <span className={className}>
      {parts.map((part, i) => {
        const isWord = /^[a-zA-Z'-]+$/.test(part);
        if (!isWord) return <span key={i}>{part}</span>;

        return (
          <span
            key={i}
            onClick={() => handleClick(part)}
            className="cursor-pointer rounded transition-colors surface-hover"
            title={`View Chinese meanings of "${part.toLowerCase()}"`}
          >
            {part}
          </span>
        );
      })}
    </span>
  );
}
