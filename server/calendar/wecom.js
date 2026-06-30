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
