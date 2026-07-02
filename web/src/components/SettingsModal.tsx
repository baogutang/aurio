import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import { spring } from '../lib/motion';
import { usePreferences } from '../context/PreferencesContext';
import type { ThemeMode, ClockStyle, LocaleMode } from '../lib/preferences';
import type { MessageKey } from '../lib/i18n';
import type { SettingsResp, AiProvidersResp, CastDevice, Track, ProfileResp, TasteResp } from '../lib/types';
import { IconClose } from './icons';

type T = (key: MessageKey) => string;
type Group = 'appearance' | 'ai' | 'ncm' | 'nas' | 'qq' | 'fish' | 'calendar' | 'weather' | 'cast' | 'taste' | 'updates';
type Res = { ok: boolean; msg: string } | null;

// ---- tiny inline icons (chevrons) ----
const ChevR = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
);
const ChevL = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
);

// ---- shared field helpers (defined outside the component to keep focus) ----
function Field({ label, type = 'text', value, onChange, placeholder }: { label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[11px] text-[var(--text-muted)] mb-1.5 block">{label}</label>
      <input className="field" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
function Area({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[11px] text-[var(--text-muted)] mb-1.5 block">{label}</label>
      <textarea className="field !h-24 !py-2 resize-none font-mono text-[12px]" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
function ResultLine({ r }: { r: Res }) {
  if (!r) return null;
  return <p className={`text-[13px] font-mono break-words ${r.ok ? '' : 'text-red-400'}`} style={r.ok ? { color: 'rgb(var(--hi-rgb))' } : undefined}>{r.msg}</p>;
}
function Buttons({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 pt-1">{children}</div>;
}

// Collapsible "how to get this" help: numbered steps + official links. Links open
// in the system browser (Electron's window-open handler / a new tab in browsers).
function Guide({ t, body, links }: { t: T; body: string; links?: { label: string; url: string }[] }) {
  const [open, setOpen] = useState(false);
  const steps = body.split('\n').map((s) => s.trim()).filter(Boolean);
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
        <span>💡 {t('guideHowTo')}</span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}><ChevR size={13} /></span>
      </button>
      {open && (
        <div className="px-3.5 pb-3 space-y-2">
          <ol className="space-y-1 text-[12px] leading-relaxed text-[var(--text-primary)] opacity-75 list-decimal list-inside">
            {steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          {links && links.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
              {links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-[12px] font-medium" style={{ color: 'rgb(var(--hi-rgb))' }}>{l.label} ↗</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
//  Panels
// =====================================================================

function AppearancePanel({ t }: { t: T }) {
  const { theme, clock, locale, setTheme, setClock, setLocale } = usePreferences();
  const themeOpts: { id: ThemeMode; label: string }[] = [
    { id: 'system', label: t('themeSystem') }, { id: 'dark', label: t('themeDark') }, { id: 'light', label: t('themeLight') },
  ];
  const localeOpts: { id: LocaleMode; label: string }[] = [
    { id: 'system', label: t('localeSystem') }, { id: 'zh', label: t('localeZh') }, { id: 'en', label: t('localeEn') },
  ];
  const clockOpts: { id: ClockStyle; label: string; desc: string }[] = [
    { id: 'matrix', label: t('clockMatrix'), desc: t('clockMatrixDesc') },
    { id: 'flip', label: t('clockFlip'), desc: t('clockFlipDesc') },
    { id: 'neon', label: t('clockNeon'), desc: t('clockNeonDesc') },
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
      <div>
        <p className="text-[11px] font-mono uppercase tracking-widest text-[var(--text-muted)] mb-2">{t('clockLabel')}</p>
        <div className="space-y-2">
          {clockOpts.map((o) => (
            <button key={o.id} onClick={() => setClock(o.id)} className="w-full text-left px-4 py-3 rounded-2xl transition-all"
              style={{ background: 'var(--inset-bg)', border: `1px solid ${clock === o.id ? 'rgba(var(--sci-cyan-rgb), 0.4)' : 'var(--glass-border)'}`, boxShadow: clock === o.id ? '0 0 20px rgba(var(--sci-cyan-rgb), 0.1)' : undefined }}>
              <p className="text-[13px] font-medium text-[var(--text-primary)]">{o.label}</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{o.desc}</p>
            </button>
          ))}
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

function FishPanel({ t, settings, onChanged }: { t: T; settings: SettingsResp | null; onChanged: () => void }) {
  const [provider, setProvider] = useState('system');
  const [systemVoice, setSystemVoice] = useState('Tingting');
  const [tencentId, setTencentId] = useState('');
  const [tencentKey, setTencentKey] = useState('');
  const [tencentVoice, setTencentVoice] = useState('1001');
  const [tencentRegion, setTencentRegion] = useState('ap-guangzhou');
  const [key, setKey] = useState('');
  const [ref, setRef] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [res, setRes] = useState<Res>(null);
  const [busy, setBusy] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.voice?.provider || 'system');
    setSystemVoice(settings.voice?.system.voice || 'Tingting');
    setTencentId('');
    setTencentKey('');
    setTencentVoice(settings.voice?.tencent.voiceType || '1001');
    setTencentRegion(settings.voice?.tencent.region || 'ap-guangzhou');
    setKey('');
    setRef(settings.fish.referenceId);
    setHasKey(settings.fish.hasKey);
  }, [settings]);

  const body = (): Record<string, string> => ({
    VOICE_PROVIDER: provider,
    SYSTEM_TTS_VOICE: systemVoice,
    TENCENT_TTS_VOICE_TYPE: tencentVoice,
    TENCENT_TTS_REGION: tencentRegion,
    ...(tencentId ? { TENCENT_SECRET_ID: tencentId } : {}),
    ...(tencentKey ? { TENCENT_SECRET_KEY: tencentKey } : {}),
    ...(key ? { FISH_API_KEY: key } : {}),
    FISH_REFERENCE_ID: ref,
  });
  const audition = async () => {
    setBusy(true); setRes({ ok: true, msg: t('fishAuditioning') });
    try {
      const r = await api.testFish(body());
      setRes({ ok: r.ok, msg: r.ok ? r.detail : '✗ ' + r.detail });
      if (r.ok && r.url && audio.current) { audio.current.src = r.url; audio.current.play().catch(() => {}); }
    } catch { setRes({ ok: false, msg: t('nasReqFail') }); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try { await api.saveSettings(body()); setRes({ ok: true, msg: t('fishSaved') }); onChanged(); }
    catch { setRes({ ok: false, msg: t('commonSaveFail') }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('fishHint')}</p>
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setProvider('system')} className={`option-chip ${provider === 'system' ? 'is-active' : ''}`}>{t('voiceSystem')}</button>
        <button onClick={() => setProvider('tencent')} className={`option-chip ${provider === 'tencent' ? 'is-active' : ''}`}>{t('voiceTencent')}</button>
        <button onClick={() => setProvider('fish')} className={`option-chip ${provider === 'fish' ? 'is-active' : ''}`}>{t('voiceFish')}</button>
      </div>
      {provider === 'system' && (
        <Field label={t('voiceSystemVoice')} value={systemVoice} onChange={setSystemVoice} placeholder="Tingting" />
      )}
      {provider === 'tencent' && (
        <div className="space-y-3">
          <Guide t={t} body={t('tcGuide')} links={[
            { label: t('guideConsole'), url: 'https://console.cloud.tencent.com/cam/capi' },
            { label: t('guideDocs'), url: 'https://cloud.tencent.com/document/product/1073/92668' },
          ]} />
          <Field label={t('voiceTencentId')} type="password" value={tencentId} onChange={setTencentId} placeholder={settings?.voice?.tencent.hasSecretId ? t('fishKeyKeep') : ''} />
          <Field label={t('voiceTencentKey')} type="password" value={tencentKey} onChange={setTencentKey} placeholder={settings?.voice?.tencent.hasSecretKey ? t('fishKeyKeep') : ''} />
          <Field label={t('voiceTencentVoice')} value={tencentVoice} onChange={setTencentVoice} placeholder="1001" />
          <Field label={t('voiceTencentRegion')} value={tencentRegion} onChange={setTencentRegion} placeholder="ap-guangzhou" />
        </div>
      )}
      {provider === 'fish' && (
        <div className="space-y-3">
          <Guide t={t} body={t('fishGuide')} links={[{ label: 'fish.audio', url: 'https://fish.audio' }]} />
          <Field label={t('fishKey')} type="password" value={key} onChange={setKey} placeholder={hasKey ? t('fishKeyKeep') : ''} />
          <Field label={t('fishRef')} value={ref} onChange={setRef} placeholder="e.g. 7f92f8afb8ec43bf81429cc1c9199cb1" />
        </div>
      )}
      <ResultLine r={res} />
      <Buttons>
        <button disabled={busy} onClick={audition} className="pill-btn flex-1 disabled:opacity-40">{t('fishAudition')}</button>
        <button disabled={busy} onClick={save} className="pill-btn pill-btn-active flex-1 disabled:opacity-40">{t('commonSave')}</button>
      </Buttons>
      <audio ref={audio} />
    </div>
  );
}

function CalendarPanel({ t, settings, onChanged }: { t: T; settings: SettingsResp | null; onChanged: () => void }) {
  const [urls, setUrls] = useState('');
  const [res, setRes] = useState<Res>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (settings) setUrls(settings.calendars.ics.urls); }, [settings]);
  const imported = settings?.calendars.ics.files || [];

  const test = async () => {
    setBusy(true); setRes({ ok: true, msg: t('commonTesting') });
    try { const r = await api.testCalendar({ CALENDAR_ICS_URLS: urls, CALENDAR_ICS_FILES: imported.join('\n') }); setRes({ ok: r.ok, msg: (r.ok ? '✓ ' : '✗ ') + r.detail }); }
    catch { setRes({ ok: false, msg: t('nasReqFail') }); }
    finally { setBusy(false); }
  };
  const testSystem = async () => {
    setBusy(true); setRes({ ok: true, msg: t('commonTesting') });
    try { const r = await api.testSystemCalendar(); setRes({ ok: r.ok, msg: (r.ok ? '✓ ' : '✗ ') + r.detail }); }
    catch { setRes({ ok: false, msg: t('nasReqFail') }); }
    finally { setBusy(false); }
  };
  const openPrivacy = async () => {
    try { const r = await api.openCalendarPrivacy(); setRes({ ok: r.ok, msg: r.detail }); }
    catch { setRes({ ok: false, msg: t('nasReqFail') }); }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setRes({ ok: true, msg: t('calImporting') });
    try {
      const content = await file.text();
      const r = await api.importCalendar({ name: file.name, content });
      setRes({ ok: r.ok, msg: (r.ok ? '✓ ' : '✗ ') + r.detail });
      onChanged();
    } catch {
      setRes({ ok: false, msg: t('nasReqFail') });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const save = async () => {
    setBusy(true);
    try { await api.saveSettings({ CALENDAR_ICS_URLS: urls, CALENDAR_ICS_FILES: imported.join('\n') }); setRes({ ok: true, msg: t('calSaved') }); onChanged(); }
    catch { setRes({ ok: false, msg: t('commonSaveFail') }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('calHint')}</p>
      <Guide t={t} body={t('calGuide')} />
      <div className="grid grid-cols-2 gap-2">
        <button disabled={busy} onClick={testSystem} className="pill-btn disabled:opacity-40">{t('calSystemTest')}</button>
        <button disabled={busy} onClick={openPrivacy} className="pill-btn disabled:opacity-40">{t('calSystemOpen')}</button>
      </div>
      <input ref={fileRef} className="hidden" type="file" accept=".ics,text/calendar" onChange={(e) => importFile(e.target.files?.[0])} />
      <button disabled={busy} onClick={() => fileRef.current?.click()} className="pill-btn w-full disabled:opacity-40">{t('calImportFile')}</button>
      {imported.length > 0 && <p className="text-[11px] text-[var(--text-muted)] font-mono">{t('calImported')}: {imported.length}</p>}
      <Area label={t('calIcsLabel')} value={urls} onChange={setUrls} placeholder={t('calIcsPh')} />
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
  const [progress, setProgress] = useState(0);
  const [currentVersion, setCurrentVersion] = useState('');
  const [latestVersion, setLatestVersion] = useState('');

  useEffect(() => {
    if (!updates?.onEvent) return;
    return updates.onEvent((payload) => {
      if (payload.event === 'download-progress') {
        setProgress(Math.round(payload.progress?.percent || 0));
        setRes({ ok: true, msg: `${t('updatesDownloading')} ${Math.round(payload.progress?.percent || 0)}%` });
      }
      if (payload.event === 'update-downloaded') {
        setDownloaded(true);
        setBusy(false);
        setRes({ ok: true, msg: t('updatesDownloaded') });
      }
      if (payload.event === 'error') {
        setBusy(false);
        setRes({ ok: false, msg: `${t('updatesError')}: ${payload.message || ''}` });
      }
    });
  }, [updates, t]);

  if (!updates) {
    return <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('updatesUnsupported')}</p>;
  }

  const check = async () => {
    setBusy(true);
    setDownloaded(false);
    setProgress(0);
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
    setBusy(true);
    setProgress(0);
    setRes({ ok: true, msg: t('updatesDownloading') });
    try {
      const r = await updates.download();
      if (r.ok) return;
      setBusy(false);
      setRes({ ok: false, msg: `${t('updatesError')}: ${r.detail || r.status || ''}` });
    } catch {
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
        <button disabled={busy} onClick={check} className="pill-btn flex-1 disabled:opacity-40">{t('updatesCheck')}</button>
        <button disabled={busy || !available || downloaded} onClick={download} className="pill-btn flex-1 disabled:opacity-40">{t('updatesDownload')}</button>
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
    { id: 'calendar', label: t('groupCalendar'), badge: settings ? ((settings.calendars.system?.enabled || settings.calendars.ics.enabled) ? t('badgeOn') : t('badgeOff')) : undefined, on: !!(settings?.calendars.system?.enabled || settings?.calendars.ics.enabled) },
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
      case 'fish': return <FishPanel t={t} settings={settings} onChanged={reloadAfterChange} />;
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
