/**
 * Watch for the user highlighting Chinese text anywhere in the app (#187).
 *
 * NO CONTAINER TAGGING. The app's chrome is English and its content is
 * Chinese, so "the selection is CJK" is a reliable proxy for "the user
 * selected study material". That means this works on review cards, browse
 * rows, meaning modals and anywhere Chinese is rendered in future, without
 * each of them opting in and without a wrapper component.
 *
 * It also composes with the existing tap-to-open-meaning gesture rather than
 * replacing it: a tap opens MeaningCard, a drag or long-press selects. That is
 * how iOS Safari, Kindle and Pleco already behave, so there is no mode to
 * enter or leave.
 */
import { useEffect, useState } from 'react';

/** Longest selection we treat as a lookup target. Beyond this it's a sentence,
 *  not a word or phrase, and "suggest sentences using this sentence" is not a
 *  question anyone is asking. */
const MAX_CHARS = 12;

const CJK = /[一-鿿]/;

export interface ChineseSelection {
  text: string;
  /** Viewport rect of the selection, for positioning the popup. */
  rect: DOMRect;
}

/** True when the selection sits inside an editable field, where the user is
 *  writing rather than reading and a popup would be in the way. */
function isEditable(node: Node | null): boolean {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return true;
    el = el.parentElement;
  }
  return false;
}

export function useChineseSelection(): {
  selection: ChineseSelection | null;
  clear: () => void;
} {
  const [selection, setSelection] = useState<ChineseSelection | null>(null);

  useEffect(() => {
    /**
     * Read on pointer/key release rather than on selectionchange. The latter
     * fires continuously mid-drag, so the popup would chase the cursor and
     * settle on partial selections.
     */
    const read = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';

      if (!sel || sel.rangeCount === 0 || !text) {
        setSelection(null);
        return;
      }
      if (text.length > MAX_CHARS || !CJK.test(text)) {
        setSelection(null);
        return;
      }
      if (isEditable(sel.anchorNode)) {
        setSelection(null);
        return;
      }

      const rect = sel.getRangeAt(0).getBoundingClientRect();
      // A zero-size rect means the range isn't laid out (collapsed or hidden).
      if (rect.width === 0 && rect.height === 0) {
        setSelection(null);
        return;
      }

      setSelection({ text, rect });
    };

    // Deferred so the browser has committed the selection before we read it —
    // on touch especially, the selection isn't final at touchend time.
    const schedule = () => setTimeout(read, 0);

    document.addEventListener('mouseup', schedule);
    document.addEventListener('touchend', schedule);
    document.addEventListener('keyup', schedule);
    return () => {
      document.removeEventListener('mouseup', schedule);
      document.removeEventListener('touchend', schedule);
      document.removeEventListener('keyup', schedule);
    };
  }, []);

  const clear = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  return { selection, clear };
}
