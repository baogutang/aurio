// The guided calendar setup contract (设置 → 日历 provider chooser):
//   · testCalendarProvider — per-provider dispatch with injectable deps: ok /
//     auth-fail / network-fail all map to human "what to DO next" guidance.
//   · explainCalendarError — the pure raw-failure → guidance mapping.
//   · POST /api/calendar/test — the HTTP face: token-guarded, validates the
//     provider name, answers { ok, detail } against SAVED credentials.
//   · POST /api/settings round-trip for the doubao voice + calendar credential
//     keys the settings panels write, and the GET /api/settings status shape
//     (voice.doubao / calendars.*) the panels derive card status from.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmpDir;
let server;
let port;
let token;
let stopServer;
let cal; // server/calendar/test.js

function api(p, opts = {}) {
  return fetch(`http://127.0.0.1:${port}${p}`, {
    ...opts,
    headers: {
      'x-aurio-token': token,
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-cal-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  process.env.PORT = '0';
  // Neutralize every spend/network path (set BEFORE import; dotenv never
  // overrides existing env).
  process.env.AI_PROVIDER = 'api';
  process.env.AI_API_KEY = '';
  process.env.VOICE_PROVIDER = 'none';
  process.env.IMAGING_ENABLED = 'false';
  process.env.OPENWEATHER_KEY = '';
  process.env.NAVIDROME_URL = '';
  process.env.NETEASE_COOKIE = '';
  process.env.QQ_COOKIE = '';
  // Calendars start unconfigured so the route tests never touch the network.
  for (const k of [
    'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'DINGTALK_APP_KEY', 'DINGTALK_APP_SECRET',
    'WECOM_CORP_ID', 'WECOM_SECRET', 'CALENDAR_ICS_URLS', 'CALENDAR_ICS_FILES',
    'DOUBAO_TTS_APPID', 'DOUBAO_TTS_TOKEN',
  ]) process.env[k] = '';

  const index = await import('../server/index.js');
  stopServer = index.stopServer;
  cal = await import('../server/calendar/test.js');
  server = await index.startServer();
  port = server.address().port;
  token = (await (await fetch(`http://127.0.0.1:${port}/api/session`)).json()).token;
}, 20000);

afterAll(async () => {
  await stopServer?.();
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}, 20000);

// ---- pure mapping: raw failure → what-to-do-next guidance ----
describe('explainCalendarError', () => {
  const netErr = () => {
    const e = new Error('fetch failed');
    e.cause = { code: 'ENOTFOUND' };
    return e;
  };

  it('maps network failures to a retry-your-network line for every provider', () => {
    for (const p of ['feishu', 'dingtalk', 'wecom']) {
      const d = cal.explainCalendarError(p, netErr());
      expect(d).toContain('连不上服务器');
      expect(d).toContain('再点一次');
    }
    const timeout = new Error('The operation timed out');
    timeout.name = 'TimeoutError';
    expect(cal.explainCalendarError('feishu', timeout)).toContain('连不上服务器');
  });

  it('maps feishu token failures to re-copy-the-credentials guidance', () => {
    const d = cal.explainCalendarError('feishu', new Error('feishu token: app not found'));
    expect(d).toContain('App ID 或 App Secret 不对');
    expect(d).toContain('凭证与基础信息');
  });

  it('maps feishu permission failures to the exact scope to enable', () => {
    const d = cal.explainCalendarError('feishu', new Error('feishu events: no permission'));
    expect(d).toContain('calendar:calendar:readonly');
    expect(d).toContain('权限管理');
  });

  it('maps dingtalk / wecom auth failures to re-copy guidance', () => {
    const bad = new Error('dingtalk auth: 不合法的appkey');
    bad.code = 'auth';
    expect(cal.explainCalendarError('dingtalk', bad)).toContain('AppKey 或 AppSecret 不对');
    const badW = new Error('wecom auth: invalid corpid');
    badW.code = 'auth';
    expect(cal.explainCalendarError('wecom', badW)).toContain('企业 ID 或应用 Secret 不对');
  });
});

// ---- dispatcher with mocked adapters: ok / auth-fail / network-fail ----
describe('testCalendarProvider (mocked adapters)', () => {
  it('feishu ok → connected line with today count', async () => {
    const r = await cal.testCalendarProvider('feishu', {
      feishuEnabled: () => true,
      feishuEvents: async () => [{ title: 'standup' }, { title: 'review' }],
    });
    expect(r).toEqual({ ok: true, detail: '✓ 飞书日历已连接 · 今天 2 个日程' });
  });

  it('feishu unconfigured → tells the user where the credentials live', async () => {
    const r = await cal.testCalendarProvider('feishu', { feishuEnabled: () => false });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('App ID');
    expect(r.detail).toContain('凭证与基础信息');
  });

  it('feishu auth-fail / network-fail → mapped guidance', async () => {
    const auth = await cal.testCalendarProvider('feishu', {
      feishuEnabled: () => true,
      feishuEvents: async () => { throw new Error('feishu token: invalid app_secret'); },
    });
    expect(auth.ok).toBe(false);
    expect(auth.detail).toContain('App ID 或 App Secret 不对');

    const net = await cal.testCalendarProvider('feishu', {
      feishuEnabled: () => true,
      feishuEvents: async () => { const e = new Error('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; },
    });
    expect(net.ok).toBe(false);
    expect(net.detail).toContain('连不上服务器');
  });

  it('dingtalk / wecom ok → honest "credentials valid, events later" line', async () => {
    const d = await cal.testCalendarProvider('dingtalk', {
      dingtalkConfigured: () => true,
      dingtalkAuth: async () => true,
    });
    expect(d.ok).toBe(true);
    expect(d.detail).toContain('钉钉凭证有效');
    expect(d.detail).toContain('ICS');

    const w = await cal.testCalendarProvider('wecom', {
      wecomConfigured: () => true,
      wecomAuth: async () => true,
    });
    expect(w.ok).toBe(true);
    expect(w.detail).toContain('企业微信凭证有效');
  });

  it('dingtalk auth-fail → mapped guidance', async () => {
    const r = await cal.testCalendarProvider('dingtalk', {
      dingtalkConfigured: () => true,
      dingtalkAuth: async () => { const e = new Error('dingtalk auth: 不合法的appkey'); e.code = 'auth'; throw e; },
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('AppKey 或 AppSecret 不对');
  });

  it('system and ics delegate to their existing testers', async () => {
    const sys = await cal.testCalendarProvider('system', {
      system: async () => ({ ok: true, detail: '✓ 本机日历已可读取 · 今天 0 个事件' }),
    });
    expect(sys.ok).toBe(true);
    const ics = await cal.testCalendarProvider('ics', {
      ics: async () => ({ ok: false, detail: '请添加至少一个 ICS 订阅或导入文件' }),
    });
    expect(ics.ok).toBe(false);
  });

  it('rejects unknown providers', async () => {
    const r = await cal.testCalendarProvider('outlook');
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('未知的日历来源');
  });
});

// ---- the HTTP face ----
describe('POST /api/calendar/test', () => {
  it('requires the session token', async () => {
    const bare = await fetch(`http://127.0.0.1:${port}/api/calendar/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'feishu' }),
    });
    expect(bare.status).toBe(403);
  });

  it('400s an unknown provider', async () => {
    const res = await api('/api/calendar/test', { method: 'POST', body: JSON.stringify({ provider: 'google' }) });
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });

  it('answers guidance (not an internal error) for unconfigured feishu / ics', async () => {
    const feishu = await (await api('/api/calendar/test', { method: 'POST', body: JSON.stringify({ provider: 'feishu' }) })).json();
    expect(feishu.ok).toBe(false);
    expect(feishu.detail).toContain('App ID');

    const ics = await (await api('/api/calendar/test', { method: 'POST', body: JSON.stringify({ provider: 'ics' }) })).json();
    expect(ics.ok).toBe(false);
    expect(ics.detail).toContain('ICS');
  });
});

// ---- settings round-trip for the keys the two panels write ----
describe('settings round-trip (doubao voice + calendar credentials)', () => {
  it('accepts the doubao keys and reflects them in voice.doubao (token as boolean)', async () => {
    const save = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        VOICE_PROVIDER: 'doubao',
        DOUBAO_TTS_APPID: 'app-777',
        DOUBAO_TTS_TOKEN: 'tok-888',
        DOUBAO_TTS_VOICE_TYPE: 'zh_female_wanwanxiaohe_moon_bigtts',
        DOUBAO_TTS_SPEED: '1.1',
        DOUBAO_TTS_EMOTION: 'happy',
      }),
    });
    expect(save.status).toBe(200);
    const s = await (await api('/api/settings')).json();
    expect(s.voice.provider).toBe('doubao');
    expect(s.voice.doubao).toEqual({
      appid: 'app-777',
      hasToken: true,
      voiceType: 'zh_female_wanwanxiaohe_moon_bigtts',
      speed: '1.1',
      emotion: 'happy',
      enabled: true,
    });
    // the raw token never leaks through GET /api/settings
    expect(JSON.stringify(s)).not.toContain('tok-888');
  });

  it('keep-if-blank: omitting the token on a later save leaves it stored', async () => {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ DOUBAO_TTS_SPEED: '0.9' }), // no token key at all
    });
    const s = await (await api('/api/settings')).json();
    expect(s.voice.doubao.hasToken).toBe(true);
    expect(s.voice.doubao.speed).toBe('0.9');
  });

  it('accepts calendar credentials and reflects status without leaking secrets', async () => {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        FEISHU_APP_ID: 'cli_abc', FEISHU_APP_SECRET: 'feishu-sec', FEISHU_CALENDAR_ID: 'primary',
        DINGTALK_APP_KEY: 'ding-key', DINGTALK_APP_SECRET: 'ding-sec',
        WECOM_CORP_ID: 'ww123', WECOM_SECRET: 'wecom-sec', WECOM_AGENT_ID: '1000002',
      }),
    });
    const s = await (await api('/api/settings')).json();
    expect(s.calendars.feishu).toMatchObject({ appId: 'cli_abc', hasSecret: true, enabled: true });
    expect(s.calendars.dingtalk).toMatchObject({ appKey: 'ding-key', hasSecret: true, configured: true });
    expect(s.calendars.wecom).toMatchObject({ corpId: 'ww123', hasSecret: true, agentId: '1000002', configured: true });
    for (const secret of ['feishu-sec', 'ding-sec', 'wecom-sec']) {
      expect(JSON.stringify(s)).not.toContain(secret);
    }
  });
});
