import { useNavigationStore } from '../stores/navigationStore';
import { ClickablePinyin } from './ClickablePinyin';

interface TokenSpanProps {
  meaningId: string;
  surfaceForm: string;
  pinyin?: string;
  pinyinNumeric?: string;
  showPinyin?: boolean;
}

export function TokenSpan({
  meaningId,
  surfaceForm,
  pinyin,
  pinyinNumeric,
  showPinyin = false,
}: TokenSpanProps) {
  const { open, push, isOpen } = useNavigationStore();

  const pinyinSyllables = pinyin?.split(/\s+/) || [];
  const pinyinNumericSyllables = pinyinNumeric?.split(/\s+/) || [];

  // For single-character tokens, clicking the character opens its meaning directly
  // For multi-character tokens, clicking the whole word opens the word meaning
  const handleWordClick = () => {
    if (isOpen) {
      push({ type: 'meaning', id: meaningId });
    } else {
      open({ type: 'meaning', id: meaningId });
    }
  };

  return (
    <span className="inline-flex flex-col items-center px-0.5">
      {/* Characters — each individually clickable for single-meaning lookup,
          or click the whole group for the word meaning */}
      <span
        onClick={handleWordClick}
        className="cursor-pointer hover:bg-blue-100 rounded px-0.5 transition-colors text-2xl"
        title="Click to view meaning"
      >
        {surfaceForm}
      </span>

      {/* Pinyin — each syllable clickable */}
      {showPinyin && pinyinSyllables.length > 0 && (
        <span className="text-xs text-gray-500 flex gap-0.5">
          {pinyinSyllables.map((syllable, i) => (
            <ClickablePinyin
              key={i}
              pinyin={syllable}
              pinyinNumeric={pinyinNumericSyllables[i] || ''}
            />
          ))}
        </span>
      )}
    </span>
  );
}
