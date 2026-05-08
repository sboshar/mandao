import { useState } from 'react';
import { useNavigate } from 'react-router';
import { CustomStudyPanel, type CustomStudyAction } from './CustomStudyPanel';
import { addNewLimitBumpToday, addReviewLimitBumpToday } from '../lib/dailyLimits';
import type { DueBreakdown } from '../services/srs';
import type { ReviewMode } from '../db/schema';

type ModeOption = ReviewMode | 'all';

interface Props {
  deckId: string;
  mode: ModeOption;
  breakdown: DueBreakdown;
  /** Called after a bump is applied so the parent can refetch counts / restart. */
  onAfterBump?: () => void;
  /** Called when the user picks Review ahead with the chosen card count. */
  onStudyAhead: (count: number) => void;
}

export function CustomStudyButton({ deckId, mode, breakdown, onAfterBump, onStudyAhead }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleConfirm = (action: CustomStudyAction) => {
    setOpen(false);
    switch (action.kind) {
      case 'bumpNew':
        addNewLimitBumpToday(deckId, action.count);
        onAfterBump?.();
        break;
      case 'bumpReview':
        addReviewLimitBumpToday(deckId, action.count);
        onAfterBump?.();
        break;
      case 'studyAhead':
        onStudyAhead(action.count);
        break;
      case 'freeReview':
        navigate('/free-review');
        break;
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-2 w-full py-2 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: 'transparent',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-strong)',
        }}
      >
        Custom study…
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="rounded-2xl shadow-xl max-w-md w-full surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold mb-4">Custom study</h2>
            <CustomStudyPanel
              breakdown={breakdown}
              mode={mode}
              onCancel={() => setOpen(false)}
              onConfirm={handleConfirm}
            />
          </div>
        </div>
      )}
    </>
  );
}
