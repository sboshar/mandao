import { create } from 'zustand';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'mandao_theme';

function loadTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export const useThemeStore = create<ThemeState>(() => {
  const initial = loadTheme();
  applyTheme(initial);

  return {
    theme: initial,
    setTheme: (t) => {
      localStorage.setItem(STORAGE_KEY, t);
      applyTheme(t);
      useThemeStore.setState({ theme: t });
    },
  };
});
