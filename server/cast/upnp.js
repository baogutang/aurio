// UPnP / DLNA cast to home speakers (Naim, Sonos-via-DLNA, WiiM, smart TVs…).
// Discovery via SSDP (node-ssdp); control via upnp-mediarenderer-client, which
// does the two-stage SetAVTransportURI + Play and exposes play/pause/stop/volume.
//
// Scope (v1): cast the current *music* track + transport controls. The DJ voice
// (TTS) stays on the local player — interleaving two URIs on one renderer is a
// later enhancement.
import ssdp from 'node-ssdp';
import MRC from 'upnp-mediarenderer-client';

const SsdpClient = ssdp.Client ?? ssdp.default?.Client;
const MediaRendererClient = MRC.default ?? MRC;

const devices = new Map(); // id -> { id, name, location }
const clients = new Map(); // location -> MediaRendererClient

// Promisify the library's (err, result) callbacks.
const p = (fn) => new Promise((resolve, reject) => fn((err, r) => (err ? reject(err) : resolve(r))));

function clientFor(id) {
  const dev = devices.get(id);
  if (!dev) throw new Error('设备不存在或已离线，请重新搜索');
  let c = clients.get(dev.location);
  if (!c) { c = new MediaRendererClient(dev.location); clients.set(dev.location, c); }
  return c;
}

export const cast = {
  // SSDP search for MediaRenderers, then read each device description for its
  // friendlyName + UDN. Returns [{ id, name, location }]; caches for later control.
  async discover(timeoutMs = 4000) {
    const client = new SsdpClient();
    const locations = new Set();
    client.on('response', (headers) => { if (headers.LOCATION) locations.add(headers.LOCATION); });
    try { client.search('urn:schemas-upnp-org:device:MediaRenderer:1'); }
    catch (e) { console.error('[cast] ssdp search:', e.message); }
    await new Promise((r) => setTimeout(r, timeoutMs));
    try { client.stop(); } catch { /* noop */ }

    const out = [];
    for (const location of locations) {
      try {
        const xml = await fetch(location, { signal: AbortSignal.timeout(4000) }).then((r) => r.text());
        const name = (xml.match(/<friendlyName>([^<]+)<\/friendlyName>/i)?.[1] || '').trim() || location;
        const udn = (xml.match(/<UDN>([^<]+)<\/UDN>/i)?.[1] || location).trim();
        const id = udn.replace(/[^a-zA-Z0-9]/g, '').slice(-24) || Buffer.from(location).toString('hex').slice(0, 16);
        const dev = { id, name, location };
        devices.set(id, dev);
        out.push(dev);
      } catch { /* unreachable description; skip */ }
    }
    return out;
  },

  async playTo(id, { streamUrl, title, artist } = {}) {
    if (!streamUrl) return { ok: false, error: '无可投放的播放地址' };
    const c = clientFor(id);
    const options = {
      autoplay: true,
      contentType: 'audio/mpeg',
      metadata: { title: title || 'Aurio', creator: artist || '', type: 'audio' },
    };
    await p((cb) => c.load(streamUrl, options, cb));
    return { ok: true };
  },

  async control(id, action) {
    const c = clientFor(id);
    if (action === 'play') await p((cb) => c.play(cb));
    else if (action === 'pause') await p((cb) => c.pause(cb));
    else if (action === 'stop') await p((cb) => c.stop(cb));
    else return { ok: false, error: '未知操作' };
    return { ok: true };
  },

  async volume(id, pct) {
    const c = clientFor(id);
    const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    await p((cb) => c.setVolume(v, cb));
    return { ok: true, volume: v };
  },

  async status(id) {
    try {
      const info = await p((cb) => clientFor(id).getTransportInfo(cb));
      return { ok: true, state: info?.CurrentTransportState || '' };
    } catch (e) { return { ok: false, error: e.message }; }
  },
};
