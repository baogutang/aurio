import { config } from '../config.js';

// Map the host locale to an OpenWeather `lang` code (e.g. zh-CN → zh_cn).
function owmLang() {
  const loc = (config.locale || 'zh-CN').toLowerCase();
  if (loc.startsWith('zh')) return (loc.includes('tw') || loc.includes('hant')) ? 'zh_tw' : 'zh_cn';
  return loc.split('-')[0];
}

let cache = { ts: 0, data: null };

export const weather = {
  enabled: () => config.weather.enabled,

  async current() {
    if (!config.weather.enabled) return null;
    if (cache.data && Date.now() - cache.ts < 30 * 60 * 1000) return cache.data;
    try {
      const u = new URL('https://api.openweathermap.org/data/2.5/weather');
      u.searchParams.set('appid', config.weather.key);
      u.searchParams.set('units', 'metric');
      u.searchParams.set('lang', owmLang());
      if (config.weather.lat && config.weather.lon) {
        u.searchParams.set('lat', config.weather.lat);
        u.searchParams.set('lon', config.weather.lon);
      } else if (config.weather.city) {
        u.searchParams.set('q', config.weather.city);
      } else return null;

      const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const data = {
        city: j.name,
        desc: j.weather?.[0]?.description || '',
        temp: Math.round(j.main?.temp),
        feels: Math.round(j.main?.feels_like),
        humidity: j.main?.humidity,
        wind: j.wind?.speed,
      };
      cache = { ts: Date.now(), data };
      return data;
    } catch (e) {
      console.error('[weather]', e.message);
      return null;
    }
  },
};

// Settings "测试" — verify candidate (or saved) creds with one live fetch.
export async function testWeather({ key, city, lat, lon } = {}) {
  key = key || config.weather.key;
  city = city || config.weather.city;
  lat = lat || config.weather.lat;
  lon = lon || config.weather.lon;
  if (!key) return { ok: false, detail: '缺少 OpenWeather API Key' };
  if (!city && !(lat && lon)) return { ok: false, detail: '请填写城市或经纬度' };
  try {
    const u = new URL('https://api.openweathermap.org/data/2.5/weather');
    u.searchParams.set('appid', key);
    u.searchParams.set('units', 'metric');
    u.searchParams.set('lang', owmLang());
    if (lat && lon) { u.searchParams.set('lat', lat); u.searchParams.set('lon', lon); }
    else u.searchParams.set('q', city);
    const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
    if (res.status === 401) return { ok: false, detail: 'API Key 无效' };
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const j = await res.json();
    return { ok: true, detail: `${j.name}：${j.weather?.[0]?.description || ''} ${Math.round(j.main?.temp)}°C` };
  } catch (e) {
    return { ok: false, detail: e.name === 'TimeoutError' ? '连接超时' : e.message };
  }
}
