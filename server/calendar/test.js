// Settings 「测试」 for every calendar provider — one route, one answer shape.
// The contract with the UI (傻瓜 bar): every failure `detail` says what to DO
// next, never what broke internally. Tests run against the SAVED credentials
// (the panel saves first, then tests), so what passes here is what the daily
// 07:00 plan beat will actually use.
import { config } from '../config.js';
import { feishu } from './feishu.js';
import { testDingtalkAuth } from './dingtalk.js';
import { testWecomAuth } from './wecom.js';
import { testSystemCalendar } from './system.js';
import { testIcs } from './ics.js';

export const CALENDAR_TEST_PROVIDERS = ['system', 'feishu', 'dingtalk', 'wecom', 'ics'];

// Pure mapping: raw adapter failure → human guidance (per provider). Exported
// separately so the mapping is testable without any network or adapter.
export function explainCalendarError(provider, error) {
  const msg = (error?.message || String(error || '')).toString();
  const network = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT|fetch failed|timeout|TimeoutError|aborted/i.test(
    `${msg} ${error?.name || ''} ${error?.cause?.code || ''}`
  );
  if (network) {
    return '连不上服务器：检查这台电脑的网络或代理，然后再点一次「保存并测试」。';
  }
  if (provider === 'feishu') {
    if (/token/i.test(msg)) {
      return 'App ID 或 App Secret 不对：回到飞书开发者后台「凭证与基础信息」页，重新复制两个值粘贴过来，再保存测试一次。';
    }
    if (/permission|权限|99991672|99991661|190010|forbidden/i.test(msg)) {
      return '应用还没有日历读取权限：去飞书开发者后台「权限管理」开通 calendar:calendar:readonly（获取日历、日程及忙闲信息），发布一个应用版本后再测。';
    }
    if (/calendar|not found|不存在|195/i.test(msg)) {
      return '找不到这个日历：日历 ID 先留空（默认 primary）；要读自己的日历，需在飞书日历里把它共享给这个应用后填它的 ID。';
    }
    return `飞书没有通过测试（${msg.slice(0, 80)}）：检查凭证与「权限管理」里的日历权限，再保存测试一次。`;
  }
  if (provider === 'dingtalk') {
    if (error?.code === 'auth' || /auth|errcode|invalid|不合法|无效/i.test(msg)) {
      return 'AppKey 或 AppSecret 不对：回到钉钉开放平台的应用「凭证与基础信息」页重新复制，再保存测试一次。';
    }
    return `钉钉没有通过测试（${msg.slice(0, 80)}）：检查 AppKey / AppSecret，再保存测试一次。`;
  }
  if (provider === 'wecom') {
    if (error?.code === 'auth' || /auth|errcode|invalid|不合法|无效/i.test(msg)) {
      return '企业 ID 或应用 Secret 不对：企业 ID 在企微管理后台「我的企业」页最下方，Secret 在自建应用详情页，重新复制后再保存测试一次。';
    }
    return `企业微信没有通过测试（${msg.slice(0, 80)}）：检查企业 ID 和 Secret，再保存测试一次。`;
  }
  return `测试失败（${msg.slice(0, 80)}）：检查配置后再试一次。`;
}

// Dispatcher. `deps` is injectable for tests; production callers pass nothing.
export async function testCalendarProvider(provider, deps = {}) {
  const d = {
    feishuEnabled: () => config.calendars.feishu.enabled,
    feishuEvents: () => feishu.todayEvents(),
    dingtalkConfigured: () => config.calendars.dingtalk.enabled,
    dingtalkAuth: () => testDingtalkAuth(),
    wecomConfigured: () => config.calendars.wecom.enabled,
    wecomAuth: () => testWecomAuth(),
    system: () => testSystemCalendar(),
    ics: () => testIcs(config.calendars.ics?.urls || [], config.calendars.ics?.files || []),
    ...deps,
  };

  switch (provider) {
    case 'system':
      return d.system();

    case 'feishu': {
      if (!d.feishuEnabled()) {
        return { ok: false, detail: '先把 App ID 和 App Secret 粘贴到上面并保存，再点测试。两个值都在飞书开发者后台「凭证与基础信息」页。' };
      }
      try {
        const events = await d.feishuEvents();
        return { ok: true, detail: `✓ 飞书日历已连接 · 今天 ${events.length} 个日程` };
      } catch (e) {
        return { ok: false, detail: explainCalendarError('feishu', e) };
      }
    }

    case 'dingtalk': {
      if (!d.dingtalkConfigured()) {
        return { ok: false, detail: '先把 AppKey 和 AppSecret 粘贴到上面并保存，再点测试。两个值在钉钉开放平台的应用详情页。' };
      }
      try {
        await d.dingtalkAuth();
        return { ok: true, detail: '✓ 钉钉凭证有效 · 日程读取会在后续版本接入，现在可先用 ICS 订阅' };
      } catch (e) {
        return { ok: false, detail: explainCalendarError('dingtalk', e) };
      }
    }

    case 'wecom': {
      if (!d.wecomConfigured()) {
        return { ok: false, detail: '先把 企业 ID 和 应用 Secret 粘贴到上面并保存，再点测试。企业 ID 在管理后台「我的企业」页，Secret 在自建应用页。' };
      }
      try {
        await d.wecomAuth();
        return { ok: true, detail: '✓ 企业微信凭证有效 · 日程读取会在后续版本接入，现在可先用 ICS 订阅' };
      } catch (e) {
        return { ok: false, detail: explainCalendarError('wecom', e) };
      }
    }

    case 'ics':
      return d.ics();

    default:
      return { ok: false, detail: `未知的日历来源：${String(provider).slice(0, 20)}` };
  }
}
