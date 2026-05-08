import { useState } from 'react';
import { EMPTY_MODE_STATE, type DueBreakdown, type ModeStateCounts } from '../services/srs';
import type { ReviewMode } from '../db/schema';
import { InfoTooltip } from './InfoTooltip';

type ModeOption = ReviewMode | 'all';

type ActionKind = 'bumpNew' | 'bumpReview' | 'studyAhead' | 'freeReview';

export type CustomStudyAction =
  | { kind: 'bumpNew'; count: number }
  | { kind: 'bumpReview'; count: number }
  | { kind: 'studyAhead'; count: number }
  | { kind: 'freeReview' };

interface Props {
  breakdown: DueBreakdown;
  mode: ModeOption;
  onCancel: () => void;
  onConfirm: (action: CustomStudyAction) => void;
}

interface ActionMeta {
  label: string;
  help: string;
  /** Null for freeReview — the "no count" branch uses a different layout. */
  count: null | {
    pick: (s: ModeStateCounts) => number;
    availableLabel: string;
    inputLabel: string;
  };
}

const ACTIONS: Record<ActionKind, ActionMeta> = {
  bumpNew: {
    label: "Increase today's new card limit",
    help: "Adds more unseen cards to today's queue beyond the daily new-card cap. These cards generate future reviews, so it does increase tomorrow's load.",
    count: {
      pick: (s) => s.newBacklog,
      availableLabel: 'Available new cards',
      inputLabel: "Increase today's new card limit by",
    },
  },
  bumpReview: {
    label: "Increase today's review card limit",
    help: "Lets you go past today's review cap on cards already due today. Doesn't change future scheduling — you're just catching up.",
    count: {
      pick: (s) => s.reviewBacklog,
      availableLabel: 'Cards held back by review limit',
      inputLabel: "Increase today's review card limit by",
    },
  },
  studyAhead: {
    label: 'Review ahead',
    help: "Pulls in cards that aren't due yet, sorted by soonest due. Ratings still update FSRS as normal early reviews. Doesn't add future load — often slightly reduces it.",
    count: {
      pick: (s) => s.futureCount,
      availableLabel: 'Future cards available',
      inputLabel: 'Pull in next',
    },
  },
  freeReview: {
    label: 'Free review (no schedule effect)',
    help: 'Drill any sentences on demand without affecting FSRS scheduling. Useful for cramming or warm-ups; ratings are NOT recorded.',
    count: null,
  },
};

const ACTION_ORDER: ActionKind[] = ['bumpNew', 'bumpReview', 'studyAhead', 'freeReview'];

export function CustomStudyPanel({ breakdown, mode, onCancel, onConfirm }: Props) {
  const states = breakdown.byModeAndState[mode] ?? EMPTY_MODE_STATE;

  const [selected, setSelected] = useState<ActionKind>('bumpNew');
  const [count, setCount] = useState<number>(20);

  const meta = ACTIONS[selected];
  const available = meta.count ? meta.count.pick(states) : 0;

  const inputDisabled = !meta.count || available === 0;
  const okDisabled = meta.count
    ? available === 0 || !Number.isFinite(count) || count < 1
    : false;

  const handleConfirm = () => {
    if (selected === 'freeReview') {
      onConfirm({ kind: 'freeReview' });
      return;
    }
    if (okDisabled) return;
    const clamped = Math.max(1, Math.min(count, Math.max(available, 1)));
    onConfirm({ kind: selected, count: clamped });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {ACTION_ORDER.map((kind) => (
          <label
            key={kind}
            className="flex items-center gap-3 px-2 py-1.5 rounded transition-colors"
            style={{ background: selected === kind ? 'var(--bg-inset)' : 'transparent' }}
          >
            <input
              type="radio"
              name="custom-study-action"
              checked={selected === kind}
              onChange={() => setSelected(kind)}
              className="accent-[var(--accent)]"
            />
            <span className="text-sm flex-1">{ACTIONS[kind].label}</span>
            <InfoTooltip help={ACTIONS[kind].help} />
          </label>
        ))}
      </div>

      {meta.count ? (
        <div
          className="p-3 rounded-lg space-y-2"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {meta.count.availableLabel}: <span style={{ color: 'var(--text-primary)' }}>{available}</span>
          </div>
          <label className="flex items-center gap-2 text-sm flex-wrap">
            <span style={{ color: 'var(--text-secondary)' }}>{meta.count.inputLabel}</span>
            <input
              type="number"
              min={1}
              max={Math.max(available, 1)}
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value, 10) || 0)}
              disabled={inputDisabled}
              className="w-20 px-2 py-1 rounded text-sm tabular-nums"
              style={{
                background: 'var(--bg-base)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            />
            <span style={{ color: 'var(--text-secondary)' }}>cards</span>
          </label>
        </div>
      ) : (
        <div
          className="p-3 rounded-lg text-xs"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          Drill any sentences without affecting FSRS scheduling. Lets you filter by tag and shuffle.
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={okDisabled}
          className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
