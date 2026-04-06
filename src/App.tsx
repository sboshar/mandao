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
import { IntroModal } from './components/IntroModal';
import { ThemeToggle } from './components/ThemeToggle';
import { useTutorialStore } from './stores/tutorialStore';
import './stores/themeStore'; // initialize theme on load

function App() {
  const [ready, setReady] = useState(false);
  const step = useTutorialStore((s) => s.step);
  const advance = useTutorialStore((s) => s.advance);

  useEffect(() => {
    Promise.all([ensureDefaults(), loadCedict()]).then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
        Loading...
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
        <div className="fixed top-3 right-4 z-40">
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
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
