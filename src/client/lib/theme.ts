import { createSignal, createEffect } from 'solid-js';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme-mode';

function getStoredMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function getSystemIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(mode: ThemeMode) {
  const isDark = mode === 'dark' || (mode === 'system' && getSystemIsDark());
  document.documentElement.setAttribute('data-theme', isDark ? 'site-dark' : 'site');
}

const [themeMode, setThemeMode] = createSignal<ThemeMode>(getStoredMode());

export { themeMode };

export function setTheme(mode: ThemeMode) {
  localStorage.setItem(STORAGE_KEY, mode);
  setThemeMode(mode);
  applyTheme(mode);
}

export function initTheme() {
  applyTheme(themeMode());

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => {
    if (themeMode() === 'system') {
      applyTheme('system');
    }
  });

  createEffect(() => {
    applyTheme(themeMode());
  });
}
