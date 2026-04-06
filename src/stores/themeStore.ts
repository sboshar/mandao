import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'mandao_theme';

function getSystemPreference(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function loadTheme(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'system';
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemPreference() : theme;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  const initial = loadTheme();
  applyTheme(initial);

  // Listen for system changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = loadTheme();
    if (current === 'system') applyTheme('system');
  });

  return {
    theme: initial,
    setTheme: (t) => {
      localStorage.setItem(STORAGE_KEY, t);
      applyTheme(t);
      set({ theme: t });
    },
  };
});
