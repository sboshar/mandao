import { useThemeStore } from '../stores/themeStore';

export function ThemeToggle() {
  const { theme, setTheme } = useThemeStore();

  const toggle = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const icon = theme === 'dark' ? '\u263E' : '\u2600';

  return (
    <button
      onClick={toggle}
      className="px-2.5 py-1 rounded-md text-xl transition-colors"
      style={{ color: 'var(--text-tertiary)' }}
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
    >
      {icon}
    </button>
  );
}
