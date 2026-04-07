import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { ensureDefaults } from './db/db';
import { loadCedict } from './lib/cedict';
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
import { useTutorialStore } from './stores/tutorialStore';
import { useAuthStore } from './stores/authStore';
import './stores/themeStore';

const LoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
    Loading...
  </div>
);

function App() {
  const [ready, setReady] = useState(false);
  const step = useTutorialStore((s) => s.step);
  const advance = useTutorialStore((s) => s.advance);
  const { user, loading: authLoading, needsPasswordReset, initialize, signOut } = useAuthStore();

  useEffect(() => {
    initialize();
  }, []);

  const userId = user?.id;
  useEffect(() => {
    if (userId && !ready) {
      Promise.all([ensureDefaults(), loadCedict()]).then(() => setReady(true));
    }
    if (!userId && ready) {
      setReady(false);
    }
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

  if (!ready) return <LoadingScreen />;

  return (
    <BrowserRouter>
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <div className="fixed top-3 right-4 z-40 flex items-center gap-2">
          <button
            onClick={signOut}
            className="px-2.5 py-1 rounded-md text-xs transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Sign out
          </button>
          <ThemeToggle />
        </div>
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
