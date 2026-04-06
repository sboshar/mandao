import { getToneNumber } from '../services/toneSandhi';

interface PinyinDisplayProps {
  /** Pinyin with diacritics: "nǐ hǎo" */
  pinyin: string;
  /** Pinyin with tone numbers for coloring: "ni3 hao3" */
  pinyinNumeric?: string;
  /** Base/dictionary pinyin (diacritics). When provided, syllables that
   *  differ from the displayed pinyin are highlighted as sandhi changes. */
  basePinyin?: string;
  className?: string;
}

const TONE_CLASSES = ['', 'tone-1', 'tone-2', 'tone-3', 'tone-4', 'tone-5'];

export function PinyinDisplay({
  pinyin,
  pinyinNumeric,
  basePinyin,
  className = '',
}: PinyinDisplayProps) {
  if (!pinyinNumeric) {
    return <span className={className}>{pinyin}</span>;
  }

  const syllables = pinyin.split(/\s+/);
  const numericSyllables = pinyinNumeric.split(/\s+/);
  const baseSyllables = basePinyin?.split(/\s+/);

  return (
    <span className={className}>
      {syllables.map((syllable, i) => {
        const tone = numericSyllables[i]
          ? getToneNumber(numericSyllables[i])
          : 5;
        const isSandhiChange =
          baseSyllables &&
          baseSyllables[i] &&
          baseSyllables[i] !== syllable;
        return (
          <span
            key={i}
            className={`${TONE_CLASSES[tone]}${
              isSandhiChange
                ? ' underline decoration-2 underline-offset-2 font-semibold'
                : ''
            }`}
            style={isSandhiChange ? { textDecorationColor: 'var(--sandhi-underline)' } : undefined}
            title={
              isSandhiChange
                ? `Base: ${baseSyllables![i]} → Sandhi: ${syllable}`
                : undefined
            }
          >
            {syllable}
            {i < syllables.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </span>
  );
}
