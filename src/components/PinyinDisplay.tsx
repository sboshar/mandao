import { getToneNumber } from '../services/toneSandhi';

interface PinyinDisplayProps {
  /** Pinyin with diacritics: "nǐ hǎo" */
  pinyin: string;
  /** Pinyin with tone numbers for coloring: "ni3 hao3" */
  pinyinNumeric?: string;
  className?: string;
}

const TONE_CLASSES = ['', 'tone-1', 'tone-2', 'tone-3', 'tone-4', 'tone-5'];

export function PinyinDisplay({
  pinyin,
  pinyinNumeric,
  className = '',
}: PinyinDisplayProps) {
  if (!pinyinNumeric) {
    return <span className={className}>{pinyin}</span>;
  }

  const syllables = pinyin.split(/\s+/);
  const numericSyllables = pinyinNumeric.split(/\s+/);

  return (
    <span className={className}>
      {syllables.map((syllable, i) => {
        const tone = numericSyllables[i]
          ? getToneNumber(numericSyllables[i])
          : 5;
        return (
          <span key={i} className={TONE_CLASSES[tone]}>
            {syllable}
            {i < syllables.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </span>
  );
}
