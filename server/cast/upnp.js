// UPnP / DLNA cast to home speakers (Naim, Sonos-via-DLNA, WiiM, smart TVs…).
// Discovery via SSDP; control via upnp-mediarenderer-client, which
// does the two-stage SetAVTransportURI + Play and exposes play/pause/stop/volume.
//
// Scope (v1): cast the current *music* track + transport controls. The DJ voice
// (TTS) stays on the local player — interleaving two URIs on one renderer is a
// later enhancement.
import dgram from 'node:dgram';
import MRC from 'upnp-mediarenderer-client';

const MediaRendererClient = MRC.default ?? MRC;
const SSDP_HOST = '239.255.255.250';
const SSDP_PORT = 1900;
const DESCRIPTION_MAX_BYTES = 1024 * 1024;

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

function parseSsdpHeaders(buf) {
  const headers = {};
  for (const line of buf.toString('utf8').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

function discoverLocations(timeoutMs) {
  return new Promise((resolve) => {
    const locations = new Set();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try { socket.close(); } catch { /* noop */ }
      resolve(locations);
    };
    const msg = Buffer.from([
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_HOST}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 2',
      'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
      '',
      '',
    ].join('\r\n'));
    const sendSearch = () => socket.send(msg, 0, msg.length, SSDP_PORT, SSDP_HOST, () => {});

    socket.on('message', (buf) => {
      const headers = parseSsdpHeaders(buf);
      const loc = headers.location;
      if (/^https?:\/\//i.test(loc || '')) locations.add(loc);
    });
    socket.on('error', (e) => { console.error('[cast] ssdp:', e.message); finish(); });
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(2);
        sendSearch();
        setTimeout(sendSearch, 450).unref?.();
      } catch (e) {
        console.error('[cast] ssdp search:', e.message);
        finish();
      }
    });
    timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
  });
}

async function fetchDescription(location) {
  const u = new URL(location);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('unsupported device URL');
  const res = await fetch(u, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`description HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > DESCRIPTION_MAX_BYTES) throw new Error('description too large');
  const xml = await res.text();
  if (Buffer.byteLength(xml) > DESCRIPTION_MAX_BYTES) throw new Error('description too large');
  return xml;
}

export const cast = {
  // SSDP search for MediaRenderers, then read each device description for its
  // friendlyName + UDN. Returns [{ id, name, location }]; caches for later control.
  async discover(timeoutMs = 4000) {
    const locations = await discoverLocations(timeoutMs);

    const out = [];
    for (const location of locations) {
      try {
        const xml = await fetchDescription(location);
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
