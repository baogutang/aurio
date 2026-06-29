// LAN networking helpers. UPnP renderers (and any other device on the network)
// fetch streams from us over the LAN, so we must hand them an absolute URL on
// this machine's LAN IP — `localhost` would resolve to the speaker itself.
import os from 'node:os';
import { config } from './config.js';

// Best LAN IPv4 of this host. Prefers 192.168.* > 10.* > 172.16–31.* > other.
export function lanIp() {
  const ifaces = os.networkInterfaces();
  const found = [];
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      found.push(ni.address);
    }
  }
  const rank = (a) =>
    a.startsWith('192.168.') ? 0 :
    a.startsWith('10.') ? 1 :
    /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3;
  found.sort((x, y) => rank(x) - rank(y));
  return found[0] || '127.0.0.1';
}

export function lanBaseUrl() {
  return `http://${lanIp()}:${config.port}`;
}
