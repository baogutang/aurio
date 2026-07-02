import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../context/PreferencesContext';
import type { ContextResp } from '../lib/types';

function fmtEventTime(ts: string | number | undefined, locale: string) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

export default function ContextGlance({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useI18n();
  const [ctx, setCtx] = useState<ContextResp | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.context()
        .then((r) => { if (alive) setCtx(r); })
        .catch(() => { if (alive) setCtx(null); });
    };
    load();
    const timer = window.setInterval(load, 10 * 60 * 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const weather = ctx?.weather;
  const nextEvent = ctx?.events?.[0];
  const hasWeather = !!weather;
  const hasCalendar = (ctx?.events?.length || 0) > 0;

  if (!hasWeather && !hasCalendar) {
    return (
      <p className={`context-glance context-glance--empty ${compact ? 'is-compact' : ''}`}>
        {t('contextEmpty')}
      </p>
    );
  }

  return (
    <div className={`context-glance ${compact ? 'is-compact' : ''}`}>
      {hasWeather && (
        <span className="context-glance-item" title={weather!.city}>
          <span className="context-glance-dot" aria-hidden />
          <span className="truncate">
            {weather!.temp}° · {weather!.desc}
            {!compact && weather!.city ? ` · ${weather!.city}` : ''}
          </span>
        </span>
      )}
      {hasCalendar && nextEvent && (
        <span className="context-glance-item" title={nextEvent.title}>
          <span className="context-glance-dot context-glance-dot--cal" aria-hidden />
          <span className="truncate">
            {fmtEventTime(nextEvent.start, locale)} {nextEvent.title}
          </span>
        </span>
      )}
    </div>
  );
}
