// 设置 → 语音: provider switch (本机系统 / 豆包 / 腾讯云 / Fish) with per-provider
// credential fields, a collapsible step-by-step guide, and a 试听 button that
// auditions the CANDIDATE settings through the existing testVoice flow.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { SettingsResp } from '../../lib/types';
import {
  DOUBAO_DEFAULT_VOICE, DOUBAO_EMOTIONS, DOUBAO_SPEED_DEFAULT, DOUBAO_SPEED_MAX, DOUBAO_SPEED_MIN,
  clampDoubaoSpeed, doubaoVoiceOptions,
} from '../../lib/settingsPanels';
import { Field, Guide, ResultLine, Buttons, Select, type T, type Res } from './shared';

export default function VoicePanel({ t, settings, onChanged }: { t: T; settings: SettingsResp | null; onChanged: () => void }) {
  const [provider, setProvider] = useState('system');
  const [systemVoice, setSystemVoice] = useState('Tingting');
  const [tencentId, setTencentId] = useState('');
  const [tencentKey, setTencentKey] = useState('');
  const [tencentVoice, setTencentVoice] = useState('1001');
  const [tencentRegion, setTencentRegion] = useState('ap-guangzhou');
  const [key, setKey] = useState('');
  const [ref, setRef] = useState('');
  const [hasKey, setHasKey] = useState(false);
  // 豆包 (Doubao / Volcengine big-model TTS)
  const [dbAppid, setDbAppid] = useState('');
  const [dbToken, setDbToken] = useState('');
  const [dbHasToken, setDbHasToken] = useState(false);
  const [dbVoice, setDbVoice] = useState(DOUBAO_DEFAULT_VOICE);
  const [dbSpeed, setDbSpeed] = useState(DOUBAO_SPEED_DEFAULT);
  const [dbEmotion, setDbEmotion] = useState('');
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
    setDbAppid(settings.voice?.doubao?.appid || '');
    setDbToken('');
    setDbHasToken(!!settings.voice?.doubao?.hasToken);
    setDbVoice(settings.voice?.doubao?.voiceType || DOUBAO_DEFAULT_VOICE);
    setDbSpeed(clampDoubaoSpeed(settings.voice?.doubao?.speed));
    setDbEmotion(settings.voice?.doubao?.emotion || '');
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
    DOUBAO_TTS_APPID: dbAppid.trim(),
    ...(dbToken ? { DOUBAO_TTS_TOKEN: dbToken } : {}), // keep-if-blank
    DOUBAO_TTS_VOICE_TYPE: dbVoice,
    DOUBAO_TTS_SPEED: String(clampDoubaoSpeed(dbSpeed)),
    DOUBAO_TTS_EMOTION: dbEmotion,
  });

  const audition = async () => {
    setBusy(true); setRes({ ok: true, msg: t('fishAuditioning') });
    try {
      const r = await api.testFish(body());
      setRes({ ok: r.ok, msg: r.ok ? r.detail : '✗ ' + r.detail });
      if (r.ok && r.url && audio.current) { audio.current.src = r.url; audio.current.play().catch(() => {}); }
    } catch { setRes({ ok: false, msg: t('reqFailHint') }); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try { await api.saveSettings(body()); setRes({ ok: true, msg: t('fishSaved') }); onChanged(); }
    catch { setRes({ ok: false, msg: t('commonSaveFail') }); }
    finally { setBusy(false); }
  };

  const emotionOpts = DOUBAO_EMOTIONS.map((e) => (e.id === '' ? { id: '', label: t('doubaoEmotionDefault') } : e));

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('voiceHint')}</p>
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setProvider('system')} className={`option-chip ${provider === 'system' ? 'is-active' : ''}`}>{t('voiceSystem')}</button>
        <button onClick={() => setProvider('doubao')} className={`option-chip ${provider === 'doubao' ? 'is-active' : ''}`}>{t('voiceDoubao')}</button>
        <button onClick={() => setProvider('tencent')} className={`option-chip ${provider === 'tencent' ? 'is-active' : ''}`}>{t('voiceTencent')}</button>
        <button onClick={() => setProvider('fish')} className={`option-chip ${provider === 'fish' ? 'is-active' : ''}`}>{t('voiceFish')}</button>
      </div>
      {provider === 'system' && (
        <Field label={t('voiceSystemVoice')} value={systemVoice} onChange={setSystemVoice} placeholder="Tingting" />
      )}
      {provider === 'doubao' && (
        <div className="space-y-3">
          <Guide t={t} body={t('doubaoGuide')} links={[
            { label: t('guideConsole'), url: 'https://console.volcengine.com/speech/app' },
            { label: t('guideDocs'), url: 'https://www.volcengine.com/docs/6561/1257544' },
          ]} />
          <Field label={t('doubaoAppid')} value={dbAppid} onChange={setDbAppid} placeholder="e.g. 1234567890" />
          <Field label={t('doubaoToken')} type="password" value={dbToken} onChange={setDbToken}
            placeholder={dbHasToken ? t('fishKeyKeep') : 'e.g. AbCdEf0123456789…'} />
          <Select label={t('doubaoVoice')} value={dbVoice} onChange={setDbVoice}
            options={doubaoVoiceOptions(dbVoice, t('doubaoCustomVoice'))} />
          <div>
            <label className="text-[11px] text-[var(--text-muted)] mb-1.5 block">
              {t('doubaoSpeed')} · {clampDoubaoSpeed(dbSpeed).toFixed(2)}×
            </label>
            <input type="range" min={DOUBAO_SPEED_MIN} max={DOUBAO_SPEED_MAX} step={0.05}
              value={clampDoubaoSpeed(dbSpeed)} onChange={(e) => setDbSpeed(Number(e.target.value))}
              className="w-full accent-[rgb(var(--hi-rgb))]" />
          </div>
          <Select label={t('doubaoEmotion')} value={dbEmotion} onChange={setDbEmotion} options={emotionOpts} />
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{t('doubaoEmotionHint')}</p>
        </div>
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
