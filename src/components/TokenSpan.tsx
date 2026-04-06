import { useNavigationStore } from '../stores/navigationStore';
import { ClickablePinyin } from './ClickablePinyin';

interface TokenSpanProps {
  meaningId: string;
  surfaceForm: string;
  /** Base/dictionary pinyin (diacritics) */
  pinyin?: string;
  /** Base pinyin with tone numbers */
  pinyinNumeric?: string;
  /** Tone-sandhi pinyin for this token in context (diacritics) */
  pinyinSandhi?: string;
  showPinyin?: boolean;
}

export function TokenSpan({
  meaningId,
  surfaceForm,
  pinyin,
  pinyinNumeric,
  pinyinSandhi,
  showPinyin = false,
}: TokenSpanProps) {
  const { open, push, isOpen } = useNavigationStore();

  // Use sandhi pinyin if available, fall back to dictionary pinyin
  const displayPinyin = pinyinSandhi || pinyin;
  const displaySyllables = displayPinyin?.split(/\s+/) || [];
  const baseSyllables = pinyin?.split(/\s+/) || [];
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
        className="cursor-pointer rounded px-0.5 transition-colors text-2xl surface-hover"
        title="Click to view meaning"
      >
        {surfaceForm}
      </span>

      {showPinyin && displaySyllables.length > 0 && (
        <span className="text-xs flex gap-0.5">
          {displaySyllables.map((syllable, i) => {
            const baseSyllable = baseSyllables[i];
            const isDifferent = baseSyllable && syllable !== baseSyllable;

            if (isDifferent) {
              return (
                <span
                  key={i}
                  className="font-medium cursor-pointer rounded transition-colors surface-hover"
                  style={{ color: 'var(--sandhi-underline)' }}
                  title={`Dictionary: ${baseSyllable} → Spoken: ${syllable}`}
                  onClick={() => {
                    const id = pinyinNumericSyllables[i] || '';
                    if (isOpen) push({ type: 'pinyin', id });
                    else open({ type: 'pinyin', id });
                  }}
                >
                  {syllable}
                </span>
              );
            }

            return (
              <ClickablePinyin
                key={i}
                pinyin={syllable}
                pinyinNumeric={pinyinNumericSyllables[i] || ''}
              />
            );
          })}
        </span>
      )}
    </span>
  );
}
