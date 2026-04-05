import { useNavigationStore } from '../stores/navigationStore';
import { ClickablePinyin } from './ClickablePinyin';

interface TokenSpanProps {
  meaningId: string;
  surfaceForm: string;
  /** Base/dictionary pinyin (diacritics) */
  pinyin?: string;
  /** Base pinyin with tone numbers */
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

  const handleWordClick = () => {
    if (isOpen) {
      push({ type: 'meaning', id: meaningId });
    } else {
      open({ type: 'meaning', id: meaningId });
    }
  };

  return (
    <span className="inline-flex flex-col items-center px-0.5">
      <span
        onClick={handleWordClick}
        className="cursor-pointer hover:bg-blue-100 rounded px-0.5 transition-colors text-2xl"
        title="Click to view meaning"
      >
        {surfaceForm}
      </span>

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
