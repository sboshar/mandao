import { useThemeStore } from '../stores/themeStore';

export function ThemeToggle() {
  const { theme, setTheme } = useThemeStore();

  const next = () => {
    const cycle = { light: 'dark' as const, dark: 'system' as const, system: 'light' as const };
    setTheme(cycle[theme]);
  };

  const label = { light: 'Light', dark: 'Dark', system: 'Auto' }[theme];
  const icon = { light: '\u2600', dark: '\u263E', system: '\u25D1' }[theme];

  return (
    <button
      onClick={next}
      className="px-2.5 py-1 rounded-md text-xs transition-colors"
      style={{ color: 'var(--text-tertiary)' }}
      title={`Theme: ${label}`}
    >
      {icon} {label}
    </button>
  );
}
