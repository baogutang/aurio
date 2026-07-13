// 设置 → 日历: a provider chooser (本机日历 / 飞书 / 钉钉 / 企业微信 / ICS), each
// card showing live status and opening a guided, foolproof setup: numbered
// steps with the exact console URL, placeholders that show the expected shape,
// keep-if-blank secrets, and a 保存并测试 that answers with what-to-DO-next
// guidance (the server's /api/calendar/test maps every failure for us).
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { SettingsResp } from '../../lib/types';
import {
  visibleCalendarProviders, calendarCardStatus,
  type CalendarProviderId, type CalendarCardStatus,
} from '../../lib/settingsPanels';
import { Field, Area, Guide, ResultLine, Buttons, ChevR, ChevL, type T, type Res } from './shared';

const PROVIDER_LABEL: Record<CalendarProviderId, 'calProvSystem' | 'calProvFeishu' | 'calProvDingtalk' | 'calProvWecom' | 'calProvIcs'> = {
  system: 'calProvSystem',
  feishu: 'calProvFeishu',
  dingtalk: 'calProvDingtalk',
  wecom: 'calProvWecom',
  ics: 'calProvIcs',
};

const STATUS_LABEL: Record<CalendarCardStatus, 'calStatusConnected' | 'calStatusSaved' | 'calStatusOff'> = {
  connected: 'calStatusConnected',
  saved: 'calStatusSaved',
  off: 'calStatusOff',
};

export default function CalendarPanel({ t, settings, onChanged }: { t: T; settings: SettingsResp | null; onChanged: () => void }) {
  const [sub, setSub] = useState<CalendarProviderId | null>(null);
  const [res, setRes] = useState<Res>(null);
  const [busy, setBusy] = useState(false);
  // feishu
  const [fsAppId, setFsAppId] = useState('');
  const [fsSecret, setFsSecret] = useState('');
  const [fsCalId, setFsCalId] = useState('');
  // dingtalk
  const [dtKey, setDtKey] = useState('');
  const [dtSecret, setDtSecret] = useState('');
  // wecom
  const [wcCorpId, setWcCorpId] = useState('');
  const [wcSecret, setWcSecret] = useState('');
  const [wcAgentId, setWcAgentId] = useState('');
  // ics
  const [urls, setUrls] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const cal = settings?.calendars;
  const imported = cal?.ics.files || [];

  useEffect(() => {
    if (!cal) return;
    setFsAppId(cal.feishu.appId || '');
    setFsSecret('');
    setFsCalId(cal.feishu.calendarId === 'primary' ? '' : (cal.feishu.calendarId || ''));
    setDtKey(cal.dingtalk.appKey || '');
    setDtSecret('');
    setWcCorpId(cal.wecom.corpId || '');
    setWcSecret('');
    setWcAgentId(cal.wecom.agentId || '');
    setUrls(cal.ics.urls || '');
  }, [cal]);

  const open = (id: CalendarProviderId) => { setSub(id); setRes(null); };
  const back = () => { setSub(null); setRes(null); };

  // Save the provider's credentials, then test against what was saved — one
  // button, no dead ends: every branch lands on a ResultLine with guidance.
  const saveAndTest = async (provider: CalendarProviderId, payload: Record<string, string>) => {
    setBusy(true); setRes({ ok: true, msg: t('commonTesting') });
    try {
      await api.saveSettings(payload);
    } catch {
      setRes({ ok: false, msg: t('commonSaveFail') });
      setBusy(false);
      return;
    }
    try {
      const r = await api.testCalendarProvider(provider);
      setRes({ ok: r.ok, msg: (r.ok ? '' : '✗ ') + r.detail });
    } catch {
      setRes({ ok: false, msg: t('reqFailHint') });
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const testSystem = async () => {
    setBusy(true); setRes({ ok: true, msg: t('commonTesting') });
    try { const r = await api.testCalendarProvider('system'); setRes({ ok: r.ok, msg: (r.ok ? '' : '✗ ') + r.detail }); }
    catch { setRes({ ok: false, msg: t('reqFailHint') }); }
    finally { setBusy(false); }
  };
  const openPrivacy = async () => {
    try { const r = await api.openCalendarPrivacy(); setRes({ ok: r.ok, msg: r.detail }); }
    catch { setRes({ ok: false, msg: t('reqFailHint') }); }
  };

  const testIcs = async () => {
    setBusy(true); setRes({ ok: true, msg: t('commonTesting') });
    try { const r = await api.testCalendar({ CALENDAR_ICS_URLS: urls, CALENDAR_ICS_FILES: imported.join('\n') }); setRes({ ok: r.ok, msg: (r.ok ? '✓ ' : '✗ ') + r.detail }); }
    catch { setRes({ ok: false, msg: t('reqFailHint') }); }
    finally { setBusy(false); }
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
      setRes({ ok: false, msg: t('reqFailHint') });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const saveIcs = async () => {
    setBusy(true);
    try { await api.saveSettings({ CALENDAR_ICS_URLS: urls, CALENDAR_ICS_FILES: imported.join('\n') }); setRes({ ok: true, msg: t('calSaved') }); onChanged(); }
    catch { setRes({ ok: false, msg: t('commonSaveFail') }); }
    finally { setBusy(false); }
  };

  // ---- root: the provider chooser ----
  if (sub === null) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('calChooserHint')}</p>
        <div className="space-y-2">
          {visibleCalendarProviders(cal).map((id) => {
            const status = calendarCardStatus(id, cal);
            return (
              <button key={id} onClick={() => open(id)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all hover:brightness-110"
                style={{ background: 'var(--inset-bg)', border: '1px solid var(--glass-border)' }}>
                <span className="flex-1 text-[13px] font-medium text-[var(--text-primary)]">{t(PROVIDER_LABEL[id])}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                  style={status !== 'off'
                    ? { color: 'rgb(var(--hi-rgb))', background: 'rgba(var(--hi-rgb),0.12)' }
                    : { color: 'var(--text-muted)', background: 'var(--glass)' }}>
                  {t(STATUS_LABEL[status])}
                </span>
                <span className="text-[var(--text-muted)]"><ChevR /></span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---- provider detail views ----
  const backRow = (
    <button onClick={back} className="flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
      <ChevL size={14} /> {t('calBackToChooser')}
    </button>
  );
  const title = <h4 className="text-[13px] font-semibold">{t(PROVIDER_LABEL[sub])}</h4>;

  if (sub === 'system') {
    return (
      <div className="space-y-3">
        {backRow}{title}
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('calSysHint')}</p>
        <div className="grid grid-cols-2 gap-2">
          <button disabled={busy} onClick={testSystem} className="pill-btn pill-btn-active disabled:opacity-40">{t('calSystemTest')}</button>
          <button disabled={busy} onClick={openPrivacy} className="pill-btn disabled:opacity-40">{t('calSystemOpen')}</button>
        </div>
        <ResultLine r={res} />
      </div>
    );
  }

  if (sub === 'feishu') {
    return (
      <div className="space-y-3">
        {backRow}{title}
        <Guide t={t} body={t('calFeishuGuide')} links={[
          { label: t('guideConsole'), url: 'https://open.feishu.cn/app' },
          { label: t('guideDocs'), url: 'https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/list' },
        ]} />
        <Field label={t('calFeishuAppId')} value={fsAppId} onChange={setFsAppId} placeholder="cli_a1b2c3d4e5f6g7h8" />
        <Field label={t('calFeishuSecret')} type="password" value={fsSecret} onChange={setFsSecret}
          placeholder={cal?.feishu.hasSecret ? t('fishKeyKeep') : 'e.g. Xw9…（32 位字符串）'} />
        <Field label={t('calFeishuCalId')} value={fsCalId} onChange={setFsCalId} placeholder="primary" />
        <ResultLine r={res} />
        <Buttons>
          <button disabled={busy} onClick={() => saveAndTest('feishu', {
            FEISHU_APP_ID: fsAppId.trim(),
            ...(fsSecret ? { FEISHU_APP_SECRET: fsSecret } : {}),
            FEISHU_CALENDAR_ID: fsCalId.trim() || 'primary',
          })} className="pill-btn pill-btn-active flex-1 disabled:opacity-40">{t('calSaveTest')}</button>
        </Buttons>
      </div>
    );
  }

  if (sub === 'dingtalk') {
    return (
      <div className="space-y-3">
        {backRow}{title}
        <Guide t={t} body={t('calDingGuide')} links={[{ label: t('guideConsole'), url: 'https://open-dev.dingtalk.com' }]} />
        <Field label={t('calDingKey')} value={dtKey} onChange={setDtKey} placeholder="dingabcdef123456789" />
        <Field label={t('calDingSecret')} type="password" value={dtSecret} onChange={setDtSecret}
          placeholder={cal?.dingtalk.hasSecret ? t('fishKeyKeep') : 'e.g. h9K…（长随机字符串）'} />
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{t('calAuthOnlyNote')}</p>
        <ResultLine r={res} />
        <Buttons>
          <button disabled={busy} onClick={() => saveAndTest('dingtalk', {
            DINGTALK_APP_KEY: dtKey.trim(),
            ...(dtSecret ? { DINGTALK_APP_SECRET: dtSecret } : {}),
          })} className="pill-btn pill-btn-active flex-1 disabled:opacity-40">{t('calSaveTest')}</button>
        </Buttons>
      </div>
    );
  }

  if (sub === 'wecom') {
    return (
      <div className="space-y-3">
        {backRow}{title}
        <Guide t={t} body={t('calWecomGuide')} links={[{ label: t('guideConsole'), url: 'https://work.weixin.qq.com/wework_admin/frame' }]} />
        <Field label={t('calWecomCorpId')} value={wcCorpId} onChange={setWcCorpId} placeholder="ww1234567890abcdef" />
        <Field label={t('calWecomSecret')} type="password" value={wcSecret} onChange={setWcSecret}
          placeholder={cal?.wecom.hasSecret ? t('fishKeyKeep') : 'e.g. Nl5…（43 位字符串）'} />
        <Field label={t('calWecomAgentId')} value={wcAgentId} onChange={setWcAgentId} placeholder="1000002" />
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{t('calAuthOnlyNote')}</p>
        <ResultLine r={res} />
        <Buttons>
          <button disabled={busy} onClick={() => saveAndTest('wecom', {
            WECOM_CORP_ID: wcCorpId.trim(),
            ...(wcSecret ? { WECOM_SECRET: wcSecret } : {}),
            WECOM_AGENT_ID: wcAgentId.trim(),
          })} className="pill-btn pill-btn-active flex-1 disabled:opacity-40">{t('calSaveTest')}</button>
        </Buttons>
      </div>
    );
  }

  // sub === 'ics'
  return (
    <div className="space-y-3">
      {backRow}{title}
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">{t('calIcsHint')}</p>
      <input ref={fileRef} className="hidden" type="file" accept=".ics,text/calendar" onChange={(e) => importFile(e.target.files?.[0])} />
      <button disabled={busy} onClick={() => fileRef.current?.click()} className="pill-btn w-full disabled:opacity-40">{t('calImportFile')}</button>
      {imported.length > 0 && <p className="text-[11px] text-[var(--text-muted)] font-mono">{t('calImported')}: {imported.length}</p>}
      <Area label={t('calIcsLabel')} value={urls} onChange={setUrls} placeholder={t('calIcsPh')} />
      <ResultLine r={res} />
      <Buttons>
        <button disabled={busy} onClick={testIcs} className="pill-btn flex-1 disabled:opacity-40">{t('commonTest')}</button>
        <button disabled={busy} onClick={saveIcs} className="pill-btn pill-btn-active flex-1 disabled:opacity-40">{t('commonSave')}</button>
      </Buttons>
    </div>
  );
}
