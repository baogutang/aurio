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
