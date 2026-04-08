import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { loadCedict } from './lib/cedict';
import { hydrateLocalDb, isHydrated } from './db/hydrate';
import { runSync, startSyncListeners, stopSyncListeners } from './db/syncEngine';
import { DashboardPage } from './pages/DashboardPage';
import { ReviewPage } from './pages/ReviewPage';
import { AddSentencePage } from './pages/AddSentencePage';
import { BrowsePage } from './pages/BrowsePage';
import { GraphPage } from './pages/GraphPage';
import { StatsPage } from './pages/StatsPage';
import { SpeakPage } from './pages/SpeakPage';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { IntroModal } from './components/IntroModal';
import { ThemeToggle } from './components/ThemeToggle';
import { SyncIndicator } from './components/SyncIndicator';
import { useTutorialStore } from './stores/tutorialStore';
import { useAuthStore } from './stores/authStore';
import './stores/themeStore';

const LoadingScreen = ({ message }: { message?: string }) => (
  <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
    {message || 'Loading...'}
  </div>
);

function App() {
  const [ready, setReady] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const step = useTutorialStore((s) => s.step);
  const advance = useTutorialStore((s) => s.advance);
  const { user, loading: authLoading, needsPasswordReset, initialize, signOut } = useAuthStore();

  useEffect(() => {
    initialize();
  }, []);

  const userId = user?.id;

  // Hydration effect: runs once when userId appears and ready is false
  useEffect(() => {
    if (!userId || ready) return;
    let cancelled = false;
    (async () => {
      try {
        const hydrated = await isHydrated();
        if (!hydrated) {
          setHydrating(true);
          await hydrateLocalDb();
          if (cancelled) return;
          setHydrating(false);
        }
        await loadCedict();
        if (!cancelled) setReady(true);
      } catch (e: any) {
        if (cancelled) return;
        setHydrating(false);
        setHydrationError(e.message || 'Failed to sync data');
      }
    })();
    return () => { cancelled = true; };
  }, [userId, ready]);

  // Sync listeners: active whenever the app is ready and user is logged in.
  // Separate effect so it is not torn down by the hydration effect's cleanup.
  useEffect(() => {
    if (!userId || !ready) return;
    startSyncListeners();
    runSync();
    return () => stopSyncListeners();
  }, [userId, ready]);

  // Sign-out: clear ready so hydration re-runs on next login
  useEffect(() => {
    if (!userId && ready) setReady(false);
  }, [userId, ready]);

  if (authLoading) return <LoadingScreen />;

  if (!user) {
    return (
      <>
        <div className="fixed top-3 right-4 z-40">
          <ThemeToggle />
        </div>
        <LoginPage />
      </>
    );
  }

  if (needsPasswordReset) {
    return (
      <>
        <div className="fixed top-3 right-4 z-40">
          <ThemeToggle />
        </div>
        <ResetPasswordPage />
      </>
    );
  }

  if (hydrationError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ color: 'var(--text-tertiary)' }}>
        <p>Sync failed: {hydrationError}</p>
        <button
          onClick={() => { setHydrationError(null); setReady(false); }}
          className="px-4 py-2 rounded-md text-sm"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (hydrating) return <LoadingScreen message="Syncing data..." />;
  if (!ready) return <LoadingScreen />;

  return (
    <BrowserRouter>
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <div
          className="fixed top-0 left-0 right-0 z-40 flex items-center justify-end gap-1.5 sm:gap-2 px-3 sm:px-4 py-0.5"
          style={{ background: 'var(--bg-base)' }}
        >
          <SyncIndicator />
          <button
            onClick={signOut}
            className="px-2 sm:px-2.5 py-1 rounded-md text-xs transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Sign out
          </button>
          <ThemeToggle />
        </div>
        <div className="h-10" />
        {step === 0 && <IntroModal onDone={advance} />}
        <Routes>
          <Route
            path="/"
            element={
              step === 1 ? <Navigate to="/add?tutorial=1" replace /> : <DashboardPage />
            }
          />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/review/:deckId" element={<ReviewPage />} />
          <Route path="/add" element={<AddSentencePage />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/speak" element={<SpeakPage />} />
          <Route path="/auth/callback" element={<Navigate to="/" replace />} />
          <Route path="/reset-password" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
