// Feishu / Lark calendar provider.
import { config } from '../config.js';

let tokenCache = { token: '', exp: 0 };

async function tenantToken() {
  const c = config.calendars.feishu;
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: c.appId, app_secret: c.appSecret }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`feishu token: ${j.msg}`);
  tokenCache = { token: j.tenant_access_token, exp: Date.now() + (j.expire - 60) * 1000 };
  return tokenCache.token;
}

export const feishu = {
  name: 'feishu',
  enabled: () => config.calendars.feishu.enabled,

  async todayEvents() {
    const c = config.calendars.feishu;
    const token = await tenantToken();
    const now = new Date();
    const start = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
    const end = start + 86400;
    const u = new URL(`https://open.feishu.cn/open-apis/calendar/v4/calendars/${encodeURIComponent(c.calendarId)}/events`);
    u.searchParams.set('start_time', start);
    u.searchParams.set('end_time', end);
    const res = await fetch(u, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    const j = await res.json();
    if (j.code !== 0) throw new Error(`feishu events: ${j.msg}`);
    return (j.data?.items || []).map((e) => ({
      title: e.summary || '(无标题)',
      start: e.start_time?.timestamp ? Number(e.start_time.timestamp) * 1000 : null,
      end: e.end_time?.timestamp ? Number(e.end_time.timestamp) * 1000 : null,
      source: 'feishu',
    }));
  },
};
