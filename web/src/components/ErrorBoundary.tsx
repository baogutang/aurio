import { Component, ErrorInfo, ReactNode } from 'react';
import { loadPreferences, resolveLocale } from '../lib/preferences';
import { t } from '../lib/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Aurio UI]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const locale = resolveLocale(loadPreferences().locale);
      return (
        <div className="min-h-screen flex flex-col gap-3 p-6" style={{ background: 'var(--bg-window)', color: 'var(--text-primary)' }}>
          <p className="text-sm uppercase tracking-widest font-mono" style={{ color: 'rgb(var(--accent-rgb))' }}>
            {t(locale, 'errorTitle')}
          </p>
          <pre className="text-[11px] whitespace-pre-wrap break-all p-3 rounded-xl" style={{ background: 'var(--inset-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
            {this.state.error.message}
          </pre>
          <button
            type="button"
            className="pill-btn pill-btn-active self-start"
            onClick={() => this.setState({ error: null })}
          >
            {t(locale, 'errorRetry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
