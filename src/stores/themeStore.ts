import { create } from 'zustand';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'mandao_theme';

function loadTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'dark' ? 'dark' : 'light';
}

/** Match `--bg-base` for each theme so the installed-PWA title bar
 *  blends seamlessly with the page underneath. Chromium reads the
 *  meta tag live in standalone mode. */
const THEME_COLORS = { light: '#f5f1eb', dark: '#282828' } as const;

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
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
