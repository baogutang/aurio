// Calendar aggregator: pulls today's events from every enabled provider and
// merges them. Add a provider by importing it and dropping it in PROVIDERS.
import { feishu } from './feishu.js';
import { dingtalk } from './dingtalk.js';
import { wecom } from './wecom.js';
import { system } from './system.js';
import { ics } from './ics.js';

const PROVIDERS = [feishu, dingtalk, wecom, system, ics];

export async function todayEvents() {
  const active = PROVIDERS.filter((p) => p.enabled());
  const results = await Promise.allSettled(active.map((p) => p.todayEvents()));
  const events = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') events.push(...results[i].value);
    else console.error(`[calendar] ${active[i].name}:`, results[i].reason?.message);
  }
  return events.sort((a, b) => (a.start || 0) - (b.start || 0));
}

export function enabledProviders() {
  return PROVIDERS.filter((p) => p.enabled()).map((p) => p.name);
}
