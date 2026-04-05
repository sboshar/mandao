import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router';
import { ensureDefaults } from './db/db';
import { loadCedict } from './lib/cedict';
import { DashboardPage } from './pages/DashboardPage';
import { ReviewPage } from './pages/ReviewPage';
import { AddSentencePage } from './pages/AddSentencePage';
import { BrowsePage } from './pages/BrowsePage';
import { GraphPage } from './pages/GraphPage';
import { StatsPage } from './pages/StatsPage';

function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([ensureDefaults(), loadCedict()]).then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
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
