/**
 * Floating action popup for highlighted Chinese text (#187).
 *
 * Mounted once, globally. Highlighting a character, a word, a phrase or a run
 * of several words is the same gesture, so this covers all of them without a
 * selection mode — and it doesn't care whether the highlight lines up with
 * token boundaries, which matters when you want to ask about 走路上班 but the
 * tokenizer split it in two.
 *
 * Deliberately generic. Selection → action is the natural home for the other
 * word-scoped features too (#14 drill cards containing a word, #34, lookups);
 * this ships with one action rather than being built around one.
 */
import { useEffect, useRef, useState } from 'react';
import { useChineseSelection } from '../hooks/useChineseSelection';
import { SuggestedPhrases } from './SuggestedPhrases';
import { isAIConfigured } from '../services/aiProvider';

/** Gap between the highlighted text and the popup. */
const OFFSET_PX = 8;
/** Roughly the popup's width, used to keep it on screen near the edges. */
const POPUP_W = 220;

export function SelectionActions() {
  const { selection, clear } = useChineseSelection();
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [target, setTarget] = useState<{ text: string; meaningIds: string[] } | null>(
    null,
  );

  /**
   * Dismiss on an interaction outside the popup.
   *
   * Because the popup no longer disappears when the selection does, it needs
   * its own way out. Listening on pointerdown covers mouse, touch and pen in
   * one handler, and the capture phase runs before React's onClick so a tap
   * on the popup itself is excluded by the containment check rather than by
   * event ordering.
   */
  useEffect(() => {
    if (!selection) return;
    const onDown = (e: Event) => {
      const node = e.target as Node | null;
      if (node && popupRef.current?.contains(node)) return;
      clear();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [selection, clear]);

  const openFor = (text: string, meaningIds: string[]) => {
    setTarget({ text, meaningIds });
    clear(); // drop the highlight so it isn't left hanging behind the modal
  };

  return (
    <>
      {selection && !target && isAIConfigured() && (
        <div
          ref={popupRef}
          className="fixed z-50 rounded-lg shadow-lg surface p-1"
          style={{
            // Prefer above the selection; flip below when there's no room, so
            // the popup never covers the text you just highlighted.
            top:
              selection.rect.top > 60
                ? selection.rect.top - OFFSET_PX - 40
                : selection.rect.bottom + OFFSET_PX,
            left: Math.max(
              8,
              Math.min(
                selection.rect.left + selection.rect.width / 2 - POPUP_W / 2,
                window.innerWidth - POPUP_W - 8,
              ),
            ),
            width: POPUP_W,
            border: '1px solid var(--border)',
          }}
          // Both are needed: mousedown for pointers, touchstart for touch.
          // Either would otherwise clear the selection before the tap resolves.
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => openFor(selection.text, selection.meaningIds)}
            className="w-full px-3 py-2 rounded text-sm text-left surface-hover"
            style={{ color: 'var(--text-primary)' }}
          >
            Suggest sentences with{' '}
            <span className="font-medium">{selection.text}</span>
          </button>
        </div>
      )}

      {target && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={() => setTarget(null)}
        >
          <div
            className="surface rounded-lg w-full max-w-md max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <div>
                <div className="text-lg">{target.text}</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  More sentences using this
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTarget(null)}
                className="px-2 py-1 rounded text-sm"
                style={{ color: 'var(--text-tertiary)' }}
              >
                ✕
              </button>
            </div>
            <div className="p-4">
              <SuggestedPhrases
                headwords={[target.text]}
                meaningIds={target.meaningIds}
                autoFetch
                onNavigate={() => setTarget(null)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
