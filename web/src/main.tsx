import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { PreferencesProvider } from './context/PreferencesContext';
import { resolveTheme, resolveLocale, loadPreferences } from './lib/preferences';
import './index.css';

const prefs = loadPreferences();
const resolved = resolveTheme(prefs.theme);
const locale = resolveLocale(prefs.locale);
document.documentElement.setAttribute('data-theme', resolved);
document.documentElement.style.colorScheme = resolved;
document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
if (typeof window !== 'undefined' && (window as Window & { aurio?: { isElectron?: boolean; platform?: string } }).aurio?.isElectron) {
  document.documentElement.setAttribute('data-electron', '');
  const platform = (window as Window & { aurio?: { platform?: string } }).aurio?.platform;
  if (platform) document.documentElement.setAttribute('data-platform', platform);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
