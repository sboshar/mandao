import { useTutorialStore, type TutorialStep } from '../stores/tutorialStore';

interface TutorialBannerProps {
  /** Only show when the tutorial is on this step */
  visibleAt: TutorialStep;
  children: React.ReactNode;
}

export function TutorialBanner({ visibleAt, children }: TutorialBannerProps) {
  const { step, advance, skipAll } = useTutorialStore();

  if (step !== visibleAt) return null;

  return (
    <div className="mb-4 p-4 rounded-lg bg-blue-50 border border-blue-200">
      <div className="flex items-start gap-3">
        <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">
          ?
        </div>
        <div className="flex-1">
          <div className="text-sm text-blue-800">{children}</div>
        </div>
        <div className="flex gap-2 shrink-0">
          {visibleAt < 4 && (
            <button
              onClick={skipAll}
              className="text-xs text-blue-400 hover:text-blue-600"
            >
              Skip tutorial
            </button>
          )}
          {visibleAt === 4 && (
            <button
              onClick={advance}
              className="text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600"
            >
              Got it!
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
