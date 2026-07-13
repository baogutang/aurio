import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import { spring } from '../lib/motion';
import { usePreferences } from '../context/PreferencesContext';
import type { ThemeMode, LocaleMode } from '../lib/preferences';
import type { SettingsResp, AiProvidersResp, CastDevice, Track, ProfileResp, TasteResp } from '../lib/types';
import { IconClose } from './icons';
import { ChevR, ChevL, Field, ResultLine, Buttons, Guide, type T, type Res } from './settings/shared';
import { anyCalendarConfigured } from '../lib/settingsPanels';
import VoicePanel from './settings/VoicePanel';
import CalendarPanel from './settings/CalendarPanel';

type Group = 'appearance' | 'ai' | 'ncm' | 'nas' | 'qq' | 'fish' | 'calendar' | 'weather' | 'cast' | 'taste' | 'updates';

// =====================================================================
//  Panels
// =====================================================================

function AppearancePanel({ t }: { t: T }) {
  const { theme, locale, setTheme, setLocale } = usePreferences();
  const themeOpts: { id: ThemeMode; label: string }[] = [
    { id: 'system', label: t('themeSystem') }, { id: 'dark', label: t('themeDark') }, { id: 'light', label: t('themeLight') },
  ];
  const localeOpts: { id: LocaleMode; label: string }[] = [
    { id: 'system', label: t('localeSystem') }, { id: 'zh', label: t('localeZh') }, { id: 'en', label: t('localeEn') },
  ];
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-mono uppercase tracking-widest text-[var(--text-muted)] mb-2">{t('localeLabel')}</p>
        <div className="flex gap-1.5">
          {localeOpts.map((o) => <button key={o.id} onClick={() => setLocale(o.id)} className={`option-chip ${locale === o.id ? 'is-active' : ''}`}>{o.label}</button>)}
        </div>
      </div>
      <div>
        <p className="text-[11px] font-mono uppercase tracking-widest text-[var(--text-muted)] mb-2">{t('themeLabel')}</p>
        <div className="flex gap-1.5">
          {themeOpts.map((o) => <button key={o.id} onClick={() => setTheme(o.id)} className={`option-chip ${theme === o.id ? 'is-active' : ''}`}>{o.label}</button>)}
        </div>
      </div>
    </div>
  );
}

function AiPanel({ t, onChanged }: { t: T; onChanged: () => void }) {
  const [prov, setProv] = useState<AiProvidersResp | null>(null);
  const [mode, setMode] = useState<'cli' | 'api'>('cli');
  const [cli, setCli] = useState('claude');      // 'claude' | 'codex' | 'cli'
  const [bin, setBin] = useState('');            // custom bin when cli === 'cli'
  const [presetId, setPresetId] = useState('glm');
  const [base, setBase] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [kind, setKind] = useState<'openai' | 'anthropic'>('openai');
  const [res, setRes] = useState<Res>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.aiProviders().then((p) => {
      setProv(p);
      if (p.current === 'api') { setMode('api'); setKind((p.api.kind as 'openai' | 'anthropic') || 'openai'); setBase(p.api.baseUrl); setModel(p.api.model); }
      else { setMode('cli'); setCli(p.current === 'codex' ? 'codex' : p.current === 'cli' ? 'cli' : 'claude'); }
      const pre = p.presets.find((x) => x.id === 'glm') || p.presets[0];
      if (pre && !p.api.baseUrl) { setPresetId(pre.id); setBase(pre.baseUrl); setModel(pre.model); setKind(pre.kind); }
    }).catch(() => {});
  }, []);

  const applyPreset = (id: string) => {
    setPresetId(id);
    const pre = prov?.presets.find((x) => x.id === id);
    if (pre) { setBase(pre.baseUrl); setModel(pre.model); setKind(pre.kind); }
  };

  const payload = (): Record<string, string> => mode === 'cli'
    ? { AI_PROVIDER: cli, ...(cli === 'cli' ? { AI_CLI_BIN: bin } : {}) }
    : { AI_PROVIDER: 'api', AI_API_KIND: kind, AI_API_BASE_URL: base, AI_API_MODEL: model, ...(key ? { AI_API_KEY: key } : {}) };

  const test = async () => {
    setBusy(true); setRes({ ok: true, msg: t('commonTesting') });
    try { const r = await api.aiTest(payload()); setRes({ ok: r.ok, msg: (r.ok ? t('aiTestOk') : '✗ ') + (r.ok ? '' : r.detail) }); return r.ok; }
    catch { setRes({ ok: false, msg: t('nasReqFail') }); return false; }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try { await api.saveSettings(payload()); setRes({ ok: true, msg: t('aiSaved') }); onChanged(); }
    catch { setRes({ ok: false, msg: t('commonSaveFail') }); }
    finally { setBusy(false); }
  };

  const cliOpts = [
    { id: 'claude', label: 'Claude', bin: 'claude' },
    { id: 'codex', label: 'Codex CLI', bin: 'codex' },
    { id: 'cli', label: t('aiCustom'), bin: '' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('aiHint')}</p>
      <div className="flex gap-1 p-1 rounded-2xl" style={{ background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' }}>
        {(['cli', 'api'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`flex-1 py-2 rounded-xl text-[12px] font-medium transition-all ${mode === m ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`} style={mode === m ? { background: 'var(--glass)' } : undefined}>
            {m === 'cli' ? t('aiTabCli') : t('aiTabApi')}
          </button>
        ))}
      </div>

      {mode === 'cli' ? (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">{t('aiCliHint')}</p>
          <div className="flex gap-1.5 flex-wrap">
            {cliOpts.map((o) => {
              const installed = o.bin ? prov?.detected?.[o.bin] : undefined;
              const unavailable = installed === false && o.id !== cli;
              return (
                <button
                  key={o.id}
                  disabled={unavailable}
                  onClick={() => setCli(o.id)}
                  className={`option-chip ${cli === o.id ? 'is-active' : ''} ${unavailable ? 'opacity-45 cursor-not-allowed' : ''}`}
                >
                  {o.label}
                  {installed !== undefined && <span className="ml-1.5 text-[9px] opacity-70">{installed ? '●' : '○'}</span>}
                </button>
              );
            })}
          </div>
          {cli !== 'cli' && (
            <p className="text-[11px] text-[var(--text-muted)] font-mono">
              {prov?.detected?.[cli] ? t('aiInstalled') : t('aiNotInstalled')}
            </p>
          )}
          {cli === 'cli' && <Field label="命令 (binary)" value={bin} onChange={setBin} placeholder="e.g. gemini" />}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-[var(--text-muted)] mb-1.5 block">{t('aiApiProvider')}</label>
            <div className="flex gap-1.5 flex-wrap">
              {prov?.presets.map((p) => (
                <button key={p.id} onClick={() => applyPreset(p.id)} className={`option-chip ${presetId === p.id ? 'is-active' : ''}`}>{p.label}</button>
              ))}
            </div>
          </div>
          <Guide t={t} body={t('aiApiGuide')} links={[
            { label: '宝谷堂中转站', url: 'https://token.baogutang.top' },
            { label: 'GLM·智谱', url: 'https://open.bigmodel.cn/usercenter/apikeys' },
            { label: 'DeepSeek', url: 'https://platform.deepseek.com/api_keys' },
            { label: 'Kimi', url: 'https://platform.moonshot.cn/console/api-keys' },
            { label: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
            { label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys' },
          ]} />
          <Field label={t('aiApiBase')} value={base} onChange={setBase} placeholder="https://…" />
          <Field label={t('aiApiModel')} value={model} onChange={setModel} placeholder="glm-4-flash" />
          <Field label={t('aiApiKey')} type="password" value={key} onChange={setKey} placeholder={prov?.api.hasKey ? t('aiApiKeyKeep') : ''} />
        </div>
      )}

      <ResultLine r={res} />
      <Buttons>
        <button disabled={busy} onClick={test} className="pill-btn flex-1 disabled:opacity-40">{t('commonTest')}</button>
        <button disabled={busy} onClick={save} className="pill-btn pill-btn-active flex-1 disabled:opacity-40">{t('commonSave')}</button>
      </Buttons>
    </div>
  );
}

function NasPanel({ t, settings, onChanged }: { t: T; settings: SettingsResp | null; onChanged: () => void }) {
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [hasPass, setHasPass] = useState(false);
  const [res, setRes] = useState<Res>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) { setUrl(settings.navidrome.url); setUser(settings.navidrome.user); setPass(''); setHasPass(settings.navidrome.hasPass); }
  }, [settings]);

  const test = async () => {
    if (!url.trim() || !user.trim()) { setRes({ ok: false, msg: t('nasFillRequired') }); return false; }
    setRes({ ok: true, msg: t('nasTesting') });
    const b: { url: string; user: string; pass?: string } = { url: url.trim(), user: user.trim() };
    if (pass) b.pass = pass;
    try { const r = await api.testNavidrome(b); setRes({ ok: r.ok, msg: (r.ok ? '✓ ' : '✗ ') + r.detail }); return r.ok; }
    catch { setRes({ ok: false, msg: t('nasReqFail') }); return false; }
  };
  const save = async () => {
    setBusy(true);
    if (await test()) {
      const payload: Record<string, string> = { NAVIDROME_URL: url.trim(), NAVIDROME_USER: user.trim() };
      if (pass) payload.NAVIDROME_PASS = pass;
      try { await api.saveSettings(payload); setRes({ ok: true, msg: t('nasSaved') }); onChanged(); }
      catch { setRes({ ok: false, msg: t('nasSaveFail') }); }
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('nasHint')}</p>
      <Guide t={t} body={t('nasGuide')} links={[{ label: 'Navidrome', url: 'https://www.navidrome.org/docs/installation/' }]} />
      <Field label={t('nasUrl')} value={url} onChange={setUrl} placeholder="https://music.example.com" />
      <Field label={t('nasUser')} value={user} onChange={setUser} />
      <Field label={t('nasPass')} type="password" value={pass} onChange={setPass} placeholder={hasPass ? t('nasPassKeep') : t('nasPassEnter')} />
      <ResultLine r={res} />
      <Buttons>
        <button disabled={busy} onClick={test} className="pill-btn flex-1 disabled:opacity-40">{t('nasTest')}</button>
        <button disabled={busy} onClick={save} className="pill-btn pill-btn-active flex-1 disabled:opacity-40">{t('nasSave')}</button>
      </Buttons>
    </div>
  );
}

function NcmPanel({ t, onChanged }: { t: T; onChanged: () => void }) {
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const poll = useRef<number | undefined>(undefined);

  useEffect(() => { setStatus(t('ncmDefaultStatus')); return () => { if (poll.current) clearInterval(poll.current); }; }, [t]);

  const start = async () => {
    setBusy(true); setStatus(t('ncmWaiting'));
    try {
      const r = await api.ncmQr();
      if (r.img && r.key) { setQr(r.img); setStatus(t('ncmScanHint')); run(r.key); }
      else { setStatus(r.error || t('ncmUnavailable')); setBusy(false); }
    } catch { setStatus(t('ncmPending')); setBusy(false); }
  };
  const run = (k: string) => {
    if (poll.current) clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      try {
        const r = await api.ncmCheck(k);
        if (r.status === 'authorized') { clearInterval(poll.current); setStatus(t('ncmAuthorized') + (r.nickname || '')); setQr(''); setBusy(false); onChanged(); }
        else if (r.status === 'expired') { clearInterval(poll.current); setStatus(t('ncmExpired')); setBusy(false); }
      } catch { clearInterval(poll.current); setBusy(false); }
    }, 2500);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('ncmHint')}</p>
      <div className="flex justify-center">
        {qr ? (
          <div className="p-3 rounded-2xl bg-white shadow-float"><img src={qr} alt="QR" className="w-44 h-44 rounded-xl" /></div>
        ) : (
          <div className="w-44 h-44 rounded-2xl glass-inset flex items-center justify-center text-[var(--text-muted)] text-sm">{t('ncmQrPlaceholder')}</div>
        )}
      </div>
      <p className="text-xs text-center font-mono" style={{ color: 'rgb(var(--hi-rgb))' }}>{status}</p>
      <button disabled={busy} onClick={start} className="pill-btn pill-btn-active w-full !py-3 disabled:opacity-40">{busy ? t('ncmWaiting') : t('ncmStart')}</button>
    </div>
  );
}

function QQPanel({ t, settings, onChanged }: { t: T; settings: SettingsResp | null; onChanged: () => void }) {
  const [apiUrl, setApiUrl] = useState('');
  const [cookie, setCookie] = useState('');
  const [hasCookie, setHasCookie] = useState(false);
  const [res, setRes] = useState<Res>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) {
      setApiUrl(settings.qq.apiUrl);
      setCookie('');
      setHasCookie(settings.qq.hasCookie);
    }
  }, [settings]);

  const body = (): Record<string, string> => ({
    QQ_API_URL: apiUrl.trim(),
    ...(cookie ? { QQ_COOKIE: cookie } : {}),
  });

  const test = async () => {
    setBusy(true);
    setRes({ ok: true, msg: t('commonTesting') });
    try {
      const r = await api.testQQ(body());
      setRes({ ok: r.ok, msg: (r.ok ? '✓ ' : '✗ ') + r.detail });
      return r.ok;
    } catch {
      setRes({ ok: false, msg: t('nasReqFail') });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.saveSettings(body());
      setRes({ ok: true, msg: t('qqSaved') });
      onChanged();
    } catch {
      setRes({ ok: false, msg: t('commonSaveFail') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('qqHint')}</p>
      <Guide t={t} body={t('qqGuide')} links={[{ label: 'y.qq.com', url: 'https://y.qq.com' }]} />
      <Field label={t('qqCookie')} type="password" value={cookie} onChange={setCookie} placeholder={hasCookie ? t('qqCookieKeep') : t('qqCookiePh')} />
      <Field label={t('qqApiUrl')} value={apiUrl} onChange={setApiUrl} placeholder={t('qqApiUrlPh')} />
      <ResultLine r={res} />
      <Buttons>
        <button disabled={busy} onClick={test} className="pill-btn flex-1 disabled:opacity-40">{t('commonTest')}</button>
        <button disabled={busy} onClick={save} className="pill-btn pill-btn-active flex-1 disabled:opacity-40">{t('commonSave')}</button>
      </Buttons>
    </div>
  );
}


function WeatherPanel({ t, settings, onChanged }: { t: T; settings: SettingsResp | null; onChanged: () => void }) {
  const [key, setKey] = useState('');
  const [city, setCity] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [res, setRes] = useState<Res>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (settings) { setKey(''); setCity(settings.weather.city); setHasKey(settings.weather.hasKey); } }, [settings]);

  const body = (): Record<string, string> => ({ ...(key ? { OPENWEATHER_KEY: key } : {}), WEATHER_CITY: city });
  const test = async () => {
    setBusy(true); setRes({ ok: true, msg: t('commonTesting') });
    try { const r = await api.testWeather(body()); setRes({ ok: r.ok, msg: (r.ok ? '✓ ' : '✗ ') + r.detail }); }
    catch { setRes({ ok: false, msg: t('nasReqFail') }); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try { await api.saveSettings(body()); setRes({ ok: true, msg: t('wxSaved') }); onChanged(); }
    catch { setRes({ ok: false, msg: t('commonSaveFail') }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('wxHint')}</p>
      <Guide t={t} body={t('wxGuide')} links={[{ label: 'OpenWeather', url: 'https://home.openweathermap.org/api_keys' }]} />
      <Field label={t('wxKey')} type="password" value={key} onChange={setKey} placeholder={hasKey ? t('wxKeyKeep') : ''} />
      <Field label={t('wxCity')} value={city} onChange={setCity} placeholder={t('wxCityPh')} />
      <ResultLine r={res} />
      <Buttons>
        <button disabled={busy} onClick={test} className="pill-btn flex-1 disabled:opacity-40">{t('commonTest')}</button>
        <button disabled={busy} onClick={save} className="pill-btn pill-btn-active flex-1 disabled:opacity-40">{t('commonSave')}</button>
      </Buttons>
    </div>
  );
}

function CastPanel({ t, currentTrack }: { t: T; currentTrack: Track | null }) {
  const [devices, setDevices] = useState<CastDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<CastDevice | null>(null);
  const [res, setRes] = useState<Res>(null);
  const [vol, setVol] = useState(50);

  const search = async () => {
    setBusy(true); setRes(null);
    try { const r = await api.castDevices(); setDevices(r.devices || []); }
    catch { setDevices([]); }
    finally { setBusy(false); }
  };
  const castTo = async (d: CastDevice) => {
    if (!currentTrack) { setRes({ ok: false, msg: t('castNoTrack') }); return; }
    setRes({ ok: true, msg: t('commonTesting') });
    try {
      const r = await api.castPlay(d.id, currentTrack);
      if (r.ok) { setActive(d); setRes({ ok: true, msg: t('castDone') }); }
      else setRes({ ok: false, msg: '✗ ' + (r.error || '') });
    } catch { setRes({ ok: false, msg: t('nasReqFail') }); }
  };
  const ctl = async (action: string) => { if (active) await api.castControl(active.id, action); };
  const setVolume = async (v: number) => { setVol(v); if (active) await api.castVolume(active.id, v); };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('castHint')}</p>
      <button disabled={busy} onClick={search} className="pill-btn pill-btn-active w-full disabled:opacity-40">{busy ? t('castSearching') : t('castSearch')}</button>

      {devices && devices.length === 0 && <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('castNone')}</p>}
      {devices && devices.length > 0 && (
        <div className="space-y-2">
          {devices.map((d) => (
            <div key={d.id} className="flex items-center gap-2 px-4 py-3 rounded-2xl" style={{ background: 'var(--inset-bg)', border: `1px solid ${active?.id === d.id ? 'rgba(var(--sci-cyan-rgb),0.4)' : 'var(--glass-border)'}` }}>
              <span className="flex-1 text-[13px] text-[var(--text-primary)] truncate">{d.name}</span>
              <button onClick={() => castTo(d)} className="pill-btn !py-1.5 !px-3 text-[11px]">{t('castCastHere')}</button>
            </div>
          ))}
        </div>
      )}

      <ResultLine r={res} />

      {active && (
        <div className="space-y-3 pt-1">
          {currentTrack && <p className="text-[12px] text-[var(--text-muted)] truncate">{t('castPlayingNow')}{currentTrack.title}</p>}
          <div className="flex gap-2">
            <button onClick={() => ctl('play')} className="pill-btn flex-1">{t('castCtlPlay')}</button>
            <button onClick={() => ctl('pause')} className="pill-btn flex-1">{t('castCtlPause')}</button>
            <button onClick={() => ctl('stop')} className="pill-btn flex-1">{t('castCtlStop')}</button>
          </div>
          <div>
            <label className="text-[11px] text-[var(--text-muted)] mb-1.5 block">{t('castVolume')} · {vol}</label>
            <input type="range" min={0} max={100} value={vol} onChange={(e) => setVolume(Number(e.target.value))} className="w-full accent-[rgb(var(--hi-rgb))]" />
          </div>
        </div>
      )}
    </div>
  );
}

function UpdatesPanel({ t }: { t: T }) {
  const updates = window.aurio?.updates;
  const releasesUrl = window.aurio?.releasesUrl;
  const [res, setRes] = useState<Res>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentVersion, setCurrentVersion] = useState('');
  const [latestVersion, setLatestVersion] = useState('');
  const autoChecked = useRef(false);

  useEffect(() => {
    if (!updates?.status) return;
    updates.status().then((s) => {
      if (s.downloaded) setDownloaded(true);
      if (s.downloading) setDownloading(true);
      if (s.version) setCurrentVersion(s.version);
      if (s.downloadedVersion) setLatestVersion(s.downloadedVersion);
    }).catch(() => {});
  }, [updates]);

  useEffect(() => {
    if (!updates || autoChecked.current) return;
    autoChecked.current = true;
    let cancelled = false;
    (async () => {
      const s = await updates.status?.().catch(() => null);
      if (cancelled || !s) return;
      if (s.downloaded || s.downloading) return;
      setBusy(true);
      setRes({ ok: true, msg: t('updatesChecking') });
      try {
        const r = await updates.check();
        if (cancelled) return;
        setCurrentVersion(r.version || '');
        setLatestVersion(r.latestVersion || r.version || '');
        if (!r.ok) {
          setAvailable(false);
          setRes({ ok: false, msg: r.status === 'dev' ? t('updatesDev') : `${t('updatesError')}: ${r.detail || r.status || ''}` });
          return;
        }
        setAvailable(!!r.updateAvailable);
        if (r.downloaded) {
          setDownloaded(true);
          setProgress(100);
          setRes({ ok: true, msg: t('updatesDownloaded') });
          return;
        }
        if (r.downloading) {
          setDownloading(true);
          setRes({ ok: true, msg: t('updatesDownloading') });
          return;
        }
        setRes({
          ok: true,
          msg: r.updateAvailable
            ? t('updatesAvailable').replace('{version}', r.latestVersion || '')
            : t('updatesNoUpdate'),
        });
      } catch {
        if (!cancelled) setRes({ ok: false, msg: t('updatesError') });
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [updates, t]);

  useEffect(() => {
    if (!updates?.onEvent) return;
    return updates.onEvent((payload) => {
      if (payload.event === 'download-progress') {
        setDownloading(true);
        setProgress(Math.round(payload.progress?.percent || 0));
        setRes({ ok: true, msg: `${t('updatesDownloading')} ${Math.round(payload.progress?.percent || 0)}%` });
      }
      if (payload.event === 'update-downloaded') {
        setDownloaded(true);
        setDownloading(false);
        setBusy(false);
        setProgress(100);
        if (payload.version) setLatestVersion(payload.version);
        setRes({ ok: true, msg: t('updatesDownloaded') });
      }
      if (payload.event === 'error') {
        setDownloading(false);
        setBusy(false);
        setRes({ ok: false, msg: `${t('updatesError')}: ${payload.message || ''}` });
      }
    });
  }, [updates, t]);

  if (!updates) {
    return <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('updatesUnsupported')}</p>;
  }

  const check = async () => {
    if (downloading) return;
    setBusy(true);
    setRes({ ok: true, msg: t('updatesChecking') });
    try {
      const r = await updates.check();
      setCurrentVersion(r.version || '');
      setLatestVersion(r.latestVersion || r.version || '');
      if (!r.ok) {
        setAvailable(false);
        setRes({ ok: false, msg: r.status === 'dev' ? t('updatesDev') : `${t('updatesError')}: ${r.detail || r.status || ''}` });
        return;
      }
      setAvailable(!!r.updateAvailable);
      if (r.downloaded) {
        setDownloaded(true);
        setProgress(100);
        setRes({ ok: true, msg: t('updatesDownloaded') });
        return;
      }
      if (r.downloading) {
        setDownloading(true);
        setRes({ ok: true, msg: t('updatesDownloading') });
        return;
      }
      setRes({
        ok: true,
        msg: r.updateAvailable
          ? t('updatesAvailable').replace('{version}', r.latestVersion || '')
          : t('updatesNoUpdate'),
      });
    } catch (e) {
      setRes({ ok: false, msg: t('updatesError') });
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (downloaded || downloading) return;
    setBusy(true);
    setDownloading(true);
    setRes({ ok: true, msg: t('updatesDownloading') });
    try {
      const r = await updates.download();
      if (r.ok) return;
      setDownloading(false);
      setBusy(false);
      setRes({ ok: false, msg: `${t('updatesError')}: ${r.detail || r.status || ''}` });
    } catch {
      setDownloading(false);
      setBusy(false);
      setRes({ ok: false, msg: t('updatesError') });
    }
  };

  const install = async () => {
    try {
      const r = await updates.install();
      if (!r.ok) setRes({ ok: false, msg: `${t('updatesError')}: ${r.detail || r.status || ''}` });
    } catch {
      setRes({ ok: false, msg: t('updatesError') });
    }
  };

  const showManualInstall = res && !res.ok && /signature|codesign|shipit|签名/i.test(res.msg || '');

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('updatesHint')}</p>
      {(currentVersion || latestVersion) && (
        <p className="text-[11px] text-[var(--text-muted)] font-mono">
          {currentVersion || '-'} → {latestVersion || '-'}
        </p>
      )}
      {progress > 0 && progress < 100 && (
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--inset-bg)' }}>
          <div className="h-full rounded-full" style={{ width: `${progress}%`, background: 'rgb(var(--hi-rgb))' }} />
        </div>
      )}
      <ResultLine r={res} />
      {showManualInstall && releasesUrl && (
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{t('updatesSignatureHint')}</p>
          <a
            href={releasesUrl}
            target="_blank"
            rel="noreferrer"
            className="pill-btn w-full inline-flex items-center justify-center text-center no-underline"
          >
            {t('updatesOpenReleases')}
          </a>
        </div>
      )}
      <Buttons>
        <button disabled={busy || downloading} onClick={check} className="pill-btn flex-1 disabled:opacity-40">{t('updatesCheck')}</button>
        <button disabled={busy || downloading || !available || downloaded} onClick={download} className="pill-btn flex-1 disabled:opacity-40">{t('updatesDownload')}</button>
      </Buttons>
      <button disabled={!downloaded} onClick={install} className="pill-btn pill-btn-active w-full disabled:opacity-40">{t('updatesInstall')}</button>
    </div>
  );
}

// =====================================================================
//  Taste profile panel
// =====================================================================

function TastePanel({ t }: { t: T }) {
  const [profile, setProfile] = useState<ProfileResp | null>(null);
  const [taste, setTaste] = useState<TasteResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [pct, setPct] = useState(0);

  const reload = () => {
    api.profile().then(setProfile).catch(() => {});
    api.taste().then(setTaste).catch(() => {});
  };

  useEffect(() => {
    reload();
    const onProgress = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (d.stage) setStage(d.stage);
      if (typeof d.pct === 'number') setPct(d.pct);
      if (d.done || d.error) {
        setBusy(false);
        reload();
      }
    };
    window.addEventListener('aurio:profile-progress', onProgress);
    return () => window.removeEventListener('aurio:profile-progress', onProgress);
  }, []);

  const build = async () => {
    setBusy(true);
    setStage(t('tasteBuilding'));
    setPct(5);
    try {
      const r = await api.buildProfile();
      if (r.busy) {
        setBusy(false);
        setStage('');
      }
    } catch {
      setBusy(false);
      setStage('');
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">{t('tasteHint')}</p>
      {profile?.exists && profile.profile ? (
        <div className="rounded-2xl p-3.5 text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--text-secondary)]"
          style={{ background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' }}>
          {profile.profile}
          {profile.generatedAt && (
            <p className="mt-2 text-[10px] font-mono text-[var(--text-muted)]">{t('tasteGenerated')}: {profile.generatedAt}</p>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-[var(--text-muted)]">{t('tasteEmpty')}</p>
      )}
      {busy && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-mono text-[var(--text-muted)]">{stage}</p>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--inset-bg)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'rgb(var(--hi-rgb))' }} />
          </div>
        </div>
      )}
      {taste && (taste.liked.length > 0 || taste.disliked.length > 0 || taste.avoidArtists.length > 0) && (
        <div className="space-y-2 text-[11px] text-[var(--text-muted)]">
          {taste.liked.length > 0 && <p><span className="font-mono uppercase tracking-wider">{t('tasteLiked')}</span> · {taste.liked.map((x) => x.name).join('、')}</p>}
          {taste.disliked.length > 0 && <p><span className="font-mono uppercase tracking-wider">{t('tasteDisliked')}</span> · {taste.disliked.map((x) => x.name).join('、')}</p>}
          {taste.avoidArtists.length > 0 && <p><span className="font-mono uppercase tracking-wider">{t('tasteAvoid')}</span> · {taste.avoidArtists.map((x) => x.artist).join('、')}</p>}
        </div>
      )}
      <Buttons>
        <button disabled={busy} onClick={build} className="pill-btn pill-btn-active flex-1 disabled:opacity-40">
          {busy ? t('tasteBuilding') : t('tasteBuild')}
        </button>
      </Buttons>
    </div>
  );
}

// =====================================================================
//  Shell: list → detail
// =====================================================================

export default function SettingsModal({ open, onClose, currentTrack = null, initialGroup }: { open: boolean; onClose: () => void; currentTrack?: Track | null; initialGroup?: Group }) {
  const { tr: t } = usePreferences();
  const [view, setView] = useState<Group | 'root'>('root');
  const [settings, setSettings] = useState<SettingsResp | null>(null);
  const [hasProfile, setHasProfile] = useState(false);

  const reload = () => api.settings().then(setSettings).catch(() => {});
  const reloadAfterChange = () => reload().finally(() => {
    window.dispatchEvent(new Event('aurio:settings-changed'));
  });

  useEffect(() => {
    if (!open) return;
    reload();
    api.profile().then((p) => setHasProfile(!!p.exists)).catch(() => {});
    setView(initialGroup ?? 'root');
    const onProfile = () => api.profile().then((p) => setHasProfile(!!p.exists)).catch(() => {});
    window.addEventListener('aurio:profile-progress', onProfile);
    return () => window.removeEventListener('aurio:profile-progress', onProfile);
  }, [open, initialGroup]);

  const groups: { id: Group; label: string; badge?: string; on?: boolean }[] = [
    { id: 'appearance', label: t('groupAppearance') },
    { id: 'ai', label: t('groupAI'), badge: settings ? (settings.ai.provider === 'api' ? (settings.ai.api.hasKey ? t('badgeOn') : t('badgeOff')) : settings.ai.provider) : undefined, on: settings ? (settings.ai.provider !== 'api' || settings.ai.api.hasKey) : false },
    { id: 'ncm', label: t('groupNcm'), badge: settings ? (settings.netease.loggedIn ? t('badgeLoggedIn') : t('badgeOff')) : undefined, on: !!settings?.netease.loggedIn },
    { id: 'nas', label: t('groupNas'), badge: settings ? (settings.navidrome.enabled ? t('badgeOn') : t('badgeOff')) : undefined, on: !!settings?.navidrome.enabled },
    { id: 'qq', label: t('groupQQ'), badge: settings ? (settings.qq.hasCookie ? t('badgeLoggedIn') : t('badgeBuiltIn')) : undefined, on: !!settings?.qq.enabled },
    { id: 'fish', label: t('groupFish'), badge: settings ? (settings.voice?.provider || 'system') : undefined, on: !!settings?.voice?.enabled },
    { id: 'calendar', label: t('groupCalendar'), badge: settings ? (anyCalendarConfigured(settings.calendars) ? t('badgeOn') : t('badgeOff')) : undefined, on: !!(settings && anyCalendarConfigured(settings.calendars)) },
    { id: 'weather', label: t('groupWeather'), badge: settings ? (settings.weather.hasKey ? t('badgeOn') : t('badgeOff')) : undefined, on: !!settings?.weather.hasKey },
    { id: 'cast', label: t('groupCast') },
    { id: 'taste', label: t('groupTaste'), badge: hasProfile ? t('badgeOn') : t('badgeOff'), on: hasProfile },
    { id: 'updates', label: t('groupUpdates'), badge: window.aurio?.isElectron ? t('badgeOn') : t('badgeOff'), on: !!window.aurio?.isElectron },
  ];

  const panel = (g: Group) => {
    switch (g) {
      case 'appearance': return <AppearancePanel t={t} />;
      case 'ai': return <AiPanel t={t} onChanged={reloadAfterChange} />;
      case 'ncm': return <NcmPanel t={t} onChanged={reloadAfterChange} />;
      case 'nas': return <NasPanel t={t} settings={settings} onChanged={reloadAfterChange} />;
      case 'qq': return <QQPanel t={t} settings={settings} onChanged={reloadAfterChange} />;
      case 'fish': return <VoicePanel t={t} settings={settings} onChanged={reloadAfterChange} />;
      case 'calendar': return <CalendarPanel t={t} settings={settings} onChanged={reloadAfterChange} />;
      case 'weather': return <WeatherPanel t={t} settings={settings} onChanged={reloadAfterChange} />;
      case 'cast': return <CastPanel t={t} currentTrack={currentTrack} />;
      case 'taste': return <TastePanel t={t} />;
      case 'updates': return <UpdatesPanel t={t} />;
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 backdrop-blur-md flex items-end sm:items-center justify-center z-50 p-4"
          style={{ background: 'var(--modal-overlay)' }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div initial={{ opacity: 0, y: 40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.97 }} transition={spring.sheet}
            className="glass-card w-full max-w-[400px] max-h-[90vh] overflow-y-auto scroll-panel rounded-[24px]">
            <div className="p-5 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-[17px] font-semibold">{t('settingsTitle')}</h2>
                  <p className="text-[11px] text-[var(--text-muted)] font-mono mt-1">{t('settingsCenterSubtitle')}</p>
                </div>
                <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]" style={{ background: 'var(--inset-bg)' }} aria-label={t('ariaClose')}>
                  <IconClose size={18} />
                </button>
              </div>

              <AnimatePresence mode="wait">
                {view === 'root' ? (
                  <motion.div key="root" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={spring.sheet} className="space-y-2">
                    {groups.map((g) => (
                      <button key={g.id} onClick={() => setView(g.id)} className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all hover:brightness-110" style={{ background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' }}>
                        <span className="flex-1 text-[13px] font-medium text-[var(--text-primary)]">{g.label}</span>
                        {g.badge && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={g.on ? { color: 'rgb(var(--hi-rgb))', background: 'rgba(var(--hi-rgb),0.12)' } : { color: 'var(--text-muted)', background: 'var(--glass)' }}>{g.badge}</span>
                        )}
                        <span className="text-[var(--text-muted)]"><ChevR /></span>
                      </button>
                    ))}
                  </motion.div>
                ) : (
                  <motion.div key={view} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={spring.sheet} className="space-y-4">
                    <button onClick={() => setView('root')} className="flex items-center gap-1 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                      <ChevL /> {t('back')}
                    </button>
                    <h3 className="text-[15px] font-semibold">{groups.find((x) => x.id === view)?.label}</h3>
                    {panel(view)}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
