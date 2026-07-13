// WeCom (企业微信) calendar provider — scaffold.
// Full impl needs: gettoken, then oa/schedule list APIs. Wire credentials in
// .env to enable; interface is ready for the aggregator.
import { config } from '../config.js';

export const wecom = {
  name: 'wecom',
  configured: () => config.calendars.wecom.enabled,
  enabled: () => false,
  async todayEvents() {
    // Not enabled until the WeCom schedule fetch is implemented.
    return [];
  },
};

// Credential check for the settings 测试 button: exchanges CorpID/Secret for an
// access_token (the cheapest call that proves the credentials are real).
// Schedule reading is not implemented yet — this validates the pasted creds only.
export async function testWecomAuth({ corpId, secret } = {}) {
  corpId = corpId || config.calendars.wecom.corpId;
  secret = secret || config.calendars.wecom.secret;
  if (!corpId || !secret) {
    const err = new Error('missing credentials');
    err.code = 'unconfigured';
    throw err;
  }
  const u = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
  u.searchParams.set('corpid', corpId);
  u.searchParams.set('corpsecret', secret);
  const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
  const j = await res.json();
  if (j.errcode !== 0 || !j.access_token) {
    const err = new Error(`wecom auth: ${j.errmsg || `errcode ${j.errcode}`}`);
    err.code = 'auth';
    throw err;
  }
  return true;
}
