/** @type {import('tailwindcss').Config} */
import siteConfig from './site.config.json';
import daisyui from 'daisyui';

export default {
  darkMode: ['class', '[data-theme="site-dark"]'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: siteConfig.themeColor,
          light: siteConfig.themeColor + '20',
        }
      },
      boxShadow: {
        'panel': '0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'panel-md': '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        'panel-lg': '0 10px 15px -3px rgb(0 0 0 / 0.07), 0 4px 6px -4px rgb(0 0 0 / 0.03)',
        'glass': '0 1px 3px 0 rgb(0 0 0 / 0.06)',
        'glass-sm': '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        'glass-md': '0 4px 6px -1px rgb(0 0 0 / 0.06)',
        'glass-lg': '0 4px 6px -1px rgb(0 0 0 / 0.07)',
        'glass-xl': '0 10px 15px -3px rgb(0 0 0 / 0.07)',
        'glass-inset': 'inset 0 1px 2px rgb(0 0 0 / 0.04)',
        'glass-button': '0 4px 14px oklch(var(--p) / 0.30)',
        'glass-button-lg': '0 8px 20px oklch(var(--p) / 0.38)',
        'glass-card': '0 1px 3px 0 rgb(0 0 0 / 0.06)',
      },
      dropShadow: {
        'glass': '0 2px 6px rgb(0 0 0 / 0.08)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out forwards',
      }
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        site: {
          primary: siteConfig.themeColor,
          'primary-content': '#ffffff',
          secondary: siteConfig.themeColor,
          'secondary-content': '#ffffff',
          accent: '#b8860b',
          'accent-content': '#ffffff',
          neutral: '#334155',
          'neutral-content': '#ffffff',
          'base-100': '#ffffff',
          'base-200': '#f1f5f9',
          'base-300': '#dde4ee',
          info: '#2563eb',
          success: '#059669',
          warning: '#d97706',
          error: '#dc2626',
          '--rounded-box': '0.375rem',
          '--rounded-btn': '0.25rem',
          '--rounded-badge': '9999px',
          '--animation-btn': '0.15s',
          '--btn-focus-scale': '0.98',
          '--border-btn': '1px',
        }
      },
      {
        'site-dark': {
          primary: siteConfig.themeColor,
          'primary-content': '#ffffff',
          secondary: siteConfig.themeColor,
          'secondary-content': '#ffffff',
          accent: '#d4a017',
          'accent-content': '#1a1a1a',
          neutral: '#94a3b8',
          'neutral-content': '#1a1a1a',
          'base-100': '#0f172a',
          'base-200': '#1e293b',
          'base-300': '#334155',
          info: '#3b82f6',
          success: '#10b981',
          warning: '#f59e0b',
          error: '#ef4444',
          '--rounded-box': '0.375rem',
          '--rounded-btn': '0.25rem',
          '--rounded-badge': '9999px',
          '--animation-btn': '0.15s',
          '--btn-focus-scale': '0.98',
          '--border-btn': '1px',
        }
      }
    ],
    darkTheme: 'site-dark',
  },
}
