// DingTalk (钉钉) calendar provider — scaffold.
// Full impl needs: get access_token, then resolve the user's unionId and call
// the calendar events API. Wire credentials in .env to enable; the interface is
// ready so it slots into the aggregator without touching callers.
import { config } from '../config.js';

export const dingtalk = {
  name: 'dingtalk',
  configured: () => config.calendars.dingtalk.enabled,
  enabled: () => false,
  async todayEvents() {
    // Not enabled until the DingTalk calendar fetch is implemented.
    return [];
  },
};

// Credential check for the settings 测试 button: exchanges AppKey/AppSecret for
// an access_token (the cheapest call that proves the credentials are real).
// Event reading is not implemented yet — this validates the pasted creds only.
export async function testDingtalkAuth({ appKey, appSecret } = {}) {
  appKey = appKey || config.calendars.dingtalk.appKey;
  appSecret = appSecret || config.calendars.dingtalk.appSecret;
  if (!appKey || !appSecret) {
    const err = new Error('missing credentials');
    err.code = 'unconfigured';
    throw err;
  }
  const u = new URL('https://oapi.dingtalk.com/gettoken');
  u.searchParams.set('appkey', appKey);
  u.searchParams.set('appsecret', appSecret);
  const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
  const j = await res.json();
  if (j.errcode !== 0 || !j.access_token) {
    const err = new Error(`dingtalk auth: ${j.errmsg || `errcode ${j.errcode}`}`);
    err.code = 'auth';
    throw err;
  }
  return true;
}
