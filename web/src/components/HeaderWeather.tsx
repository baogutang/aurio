import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import PixelWeather from './PixelWeather';
import type { ContextResp } from '../lib/types';

export default function HeaderWeather() {
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
  if (!weather) return null;

  return (
    <PixelWeather
      desc={weather.desc}
      temp={weather.temp}
      city={weather.city}
      className="shrink-0"
    />
  );
}
