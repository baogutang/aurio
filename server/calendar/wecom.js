// WeCom (企业微信) calendar provider — scaffold.
// Full impl needs: gettoken, then oa/schedule list APIs. Wire credentials in
// .env to enable; interface is ready for the aggregator.
import { config } from '../config.js';

export const wecom = {
  name: 'wecom',
  enabled: () => config.calendars.wecom.enabled,
  async todayEvents() {
    // TODO(phase 3): implement WeCom schedule fetch.
    return [];
  },
};
