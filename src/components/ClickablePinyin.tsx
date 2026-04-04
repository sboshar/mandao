import { useNavigationStore } from '../stores/navigationStore';
import { getToneNumber } from '../services/toneSandhi';

const TONE_CLASSES = ['', 'tone-1', 'tone-2', 'tone-3', 'tone-4', 'tone-5'];

interface ClickablePinyinProps {
  /** Pinyin with diacritics for display: e.g. "chà" */
  pinyin: string;
  /** Pinyin with tone number for lookup: e.g. "cha4" */
  pinyinNumeric: string;
  className?: string;
}

/**
 * A single clickable pinyin syllable.
 * Clicking opens the PinyinCard showing all characters with this sound.
 */
export function ClickablePinyin({
  pinyin,
  pinyinNumeric,
  className = '',
}: ClickablePinyinProps) {
  const { push, open, isOpen } = useNavigationStore();
  const tone = getToneNumber(pinyinNumeric);

  const handleClick = () => {
    if (isOpen) {
      push({ type: 'pinyin', id: pinyinNumeric });
    } else {
      open({ type: 'pinyin', id: pinyinNumeric });
    }
  };

  return (
    <span
      onClick={handleClick}
      className={`cursor-pointer hover:bg-purple-100 rounded transition-colors
        ${TONE_CLASSES[tone]} ${className}`}
      title={`View all characters pronounced ${pinyin}`}
    >
      {pinyin}
    </span>
  );
}
