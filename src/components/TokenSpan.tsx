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

  const pinyinSyllables = pinyin?.split(/\s+/) || [];
  const pinyinNumericSyllables = pinyinNumeric?.split(/\s+/) || [];
  const sandhiSyllables = pinyinSandhi?.split(/\s+/) || [];
  const hasSandhi = pinyinSandhi && pinyin && pinyinSandhi !== pinyin;

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

      {showPinyin && pinyinSyllables.length > 0 && (
        <span className="text-xs flex gap-0.5">
          {pinyinSyllables.map((syllable, i) => {
            const sandhiDiffers = hasSandhi && sandhiSyllables[i] && sandhiSyllables[i] !== syllable;

            if (sandhiDiffers) {
              return (
                <span
                  key={i}
                  className="font-medium cursor-pointer rounded transition-colors surface-hover"
                  style={{ color: 'var(--sandhi-underline)' }}
                  title={`Dictionary: ${syllable} → Spoken: ${sandhiSyllables[i]}`}
                  onClick={() => {
                    if (isOpen) {
                      push({ type: 'pinyin', id: pinyinNumericSyllables[i] || '' });
                    } else {
                      open({ type: 'pinyin', id: pinyinNumericSyllables[i] || '' });
                    }
                  }}
                >
                  {sandhiSyllables[i]}
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
