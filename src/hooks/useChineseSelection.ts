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
import { useCallback, useEffect, useState } from 'react';

/** Longest selection we treat as a lookup target. Beyond this it's a sentence,
 *  not a word or phrase, and "suggest sentences using this sentence" is not a
 *  question anyone is asking. */
const MAX_CHARS = 12;

/** How long the selection must hold still before selectionchange is believed.
 *  Long enough to ride out a handle drag, short enough not to feel laggy. */
const SELECTION_SETTLE_MS = 350;

const CJK = /[一-鿿]/;
/** Everything that isn't a Han character. */
const NOT_CJK = /[^一-鿿]/g;

/**
 * Reduce a raw selection to just its Han characters.
 *
 * TokenSpan stacks each token's pinyin under its characters, so dragging
 * across 我饿了 in Browse yields "我\nwǒ\n饿\nè\n了". Dropping everything that
 * isn't a Han character recovers the sentence, and incidentally strips
 * punctuation and the whitespace between tokens — all of which would otherwise
 * be sent to the model as part of the word.
 */
export function hanOnly(raw: string): string {
  return raw.replace(NOT_CJK, '');
}

export interface ChineseSelection {
  text: string;
  /** Viewport rect of the selection, for positioning the popup. */
  rect: DOMRect;
  /**
   * Meaning ids of the tokens the highlight touches, in document order.
   *
   * This is the sense the user is actually looking at. Resolving by headword
   * instead would be a guess — 意思 can be "meaning" or "a small gift", and two
   * sentences in the deck may use both. The DOM knows which one is on screen;
   * a headword lookup does not.
   *
   * Empty when the highlight isn't inside rendered tokens (e.g. plain sentence
   * text in Browse), which is fine — the request just goes out unconstrained.
   */
  meaningIds: string[];
}

/**
 * Collect the meaning ids of every token element the range touches.
 *
 * TokenSpan stamps data-meaning-id, so this walks the range's ancestor for
 * those elements and keeps the ones that actually intersect. A selection inside
 * a single token has that token as an ancestor rather than a descendant, hence
 * the closest() check as well.
 */
export function meaningIdsInRange(range: Range): string[] {
  const node = range.commonAncestorContainer;
  const el: Element | null =
    node instanceof Element ? node : (node.parentElement ?? null);
  if (!el) return [];

  const ids: string[] = [];
  const push = (candidate: Element | null) => {
    if (!candidate) return;
    const id = candidate.getAttribute('data-meaning-id');
    if (id && !ids.includes(id)) ids.push(id);
  };

  // Selection sits entirely inside one token.
  push(el.closest('[data-meaning-id]'));
  // Selection spans several tokens under a common ancestor.
  for (const candidate of el.querySelectorAll('[data-meaning-id]')) {
    if (range.intersectsNode(candidate)) push(candidate);
  }
  return ids;
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

/**
 * Reports the current Chinese selection, and KEEPS REPORTING IT after the
 * browser drops the highlight.
 *
 * That stickiness is what makes the feature work on touch. Tapping the action
 * popup clears the selection before the tap resolves, so a component rendering
 * straight off the live selection would unmount mid-tap and the tap would never
 * land. Holding the last real selection decouples the popup's lifetime from the
 * highlight; callers dismiss it explicitly via clear().
 */
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
      const raw = sel?.toString() ?? '';

      // Losing the highlight is not the same as choosing nothing — see the
      // stickiness note above. Only a real selection replaces the current one.
      if (!sel || sel.rangeCount === 0 || !CJK.test(raw)) return;

      // Length is judged on the Han characters alone. The raw string is padded
      // with interleaved pinyin, so measuring it would reject short selections
      // for being long.
      const text = hanOnly(raw);
      if (!text || text.length > MAX_CHARS) return;
      if (isEditable(sel.anchorNode)) return;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      // A zero-size rect means the range isn't laid out (collapsed or hidden).
      if (rect.width === 0 && rect.height === 0) return;

      setSelection({ text, rect, meaningIds: meaningIdsInRange(range) });
    };

    // Deferred so the browser has committed the selection before we read it —
    // on touch especially, the selection isn't final at touchend time.
    // Only one is ever pending; a rapid second release supersedes the first.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      clearTimeout(pending);
      pending = setTimeout(read, delay);
    };
    const onRelease = () => schedule(0);

    /**
     * selectionchange is the only event iOS fires for selection-handle drags.
     * After a long-press the handles are native UI, so adjusting them changes
     * the selection without any touchend reaching document — meaning a mobile
     * user could widen their highlight and the popup would still describe the
     * original word.
     *
     * It also fires continuously mid-drag, which is why it isn't the primary
     * signal: reading on every tick would make the popup chase the cursor. The
     * delay waits for the selection to settle instead.
     */
    const onSelectionChange = () => schedule(SELECTION_SETTLE_MS);

    document.addEventListener('mouseup', onRelease);
    document.addEventListener('touchend', onRelease);
    document.addEventListener('keyup', onRelease);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      // Otherwise a release just before unmount lands in a dead component.
      clearTimeout(pending);
      document.removeEventListener('mouseup', onRelease);
      document.removeEventListener('touchend', onRelease);
      document.removeEventListener('keyup', onRelease);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, []);

  // Stable identity: consumers put this in effect dependencies, and a new
  // function each render would resubscribe their listeners on every render.
  const clear = useCallback(() => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  return { selection, clear };
}
