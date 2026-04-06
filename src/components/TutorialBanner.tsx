import { useTutorialStore, type TutorialStep } from '../stores/tutorialStore';

interface TutorialBannerProps {
  visibleAt: TutorialStep;
  children: React.ReactNode;
}

export function TutorialBanner({ visibleAt, children }: TutorialBannerProps) {
  const { step, advance, skipAll } = useTutorialStore();

  if (step !== visibleAt) return null;

  return (
    <div
      className="mb-4 p-4 rounded-lg"
      style={{
        background: 'var(--accent-subtle)',
        border: '1px solid var(--accent)',
        borderColor: `color-mix(in srgb, var(--accent) 40%, transparent)`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5"
          style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
        >
          ?
        </div>
        <div className="flex-1">
          <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{children}</div>
        </div>
        <div className="flex gap-2 shrink-0">
          {visibleAt !== 5 && visibleAt !== 6 && (
            <button
              onClick={skipAll}
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Skip tutorial
            </button>
          )}
          {visibleAt === 5 && (
            <button
              onClick={() => { advance(); }}
              className="text-xs px-2 py-1 rounded"
              style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
            >
              Got it!
            </button>
          )}
          {visibleAt === 6 && (
            <button
              onClick={advance}
              className="text-xs px-2 py-1 rounded"
              style={{ background: 'var(--accent)', color: 'var(--text-inverted)' }}
            >
              Finish tutorial
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
