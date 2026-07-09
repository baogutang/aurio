import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'build');
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));

function color(hex, alpha = 1) {
  const clean = hex.replace('#', '');
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
    a: alpha,
  };
}

function mix(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

function image(size) {
  return { width: size, height: size, pixels: Buffer.alloc(size * size * 4) };
}

function blendPixel(img, x, y, c, coverage = 1) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  const a = clamp((c.a ?? 1) * coverage);
  const inv = 1 - a;
  img.pixels[i] = Math.round(c.r * a + img.pixels[i] * inv);
  img.pixels[i + 1] = Math.round(c.g * a + img.pixels[i + 1] * inv);
  img.pixels[i + 2] = Math.round(c.b * a + img.pixels[i + 2] * inv);
  img.pixels[i + 3] = Math.round(255 * a + img.pixels[i + 3] * inv);
}

function fillRoundedRect(img, x, y, w, h, r, paint) {
  const minX = Math.floor(x - 2);
  const maxX = Math.ceil(x + w + 2);
  const minY = Math.floor(y - 2);
  const maxY = Math.ceil(y + h + 2);
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const qx = Math.abs(px + 0.5 - (x + w / 2)) - w / 2 + r;
      const qy = Math.abs(py + 0.5 - (y + h / 2)) - h / 2 + r;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      const coverage = clamp(0.75 - outside);
      if (coverage > 0) blendPixel(img, px, py, typeof paint === 'function' ? paint(px, py) : paint, coverage);
    }
  }
}

function fillEllipse(img, cx, cy, rx, ry, paint) {
  const minX = Math.floor(cx - rx - 2);
  const maxX = Math.ceil(cx + rx + 2);
  const minY = Math.floor(cy - ry - 2);
  const maxY = Math.ceil(cy + ry + 2);
  const aa = Math.max(1, Math.min(rx, ry) * 0.008);
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const dx = (px + 0.5 - cx) / rx;
      const dy = (py + 0.5 - cy) / ry;
      const d = (Math.hypot(dx, dy) - 1) * Math.min(rx, ry);
      const coverage = clamp(0.75 - d / aa);
      if (coverage > 0) blendPixel(img, px, py, typeof paint === 'function' ? paint(px, py) : paint, coverage);
    }
  }
}

function radialGlow(img, cx, cy, radius, base) {
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / radius;
      if (d < 1) blendPixel(img, px, py, { ...base, a: base.a * (1 - d) * (1 - d) });
    }
  }
}

// 12×13 — matches web/src/components/PixelPet.tsx
const SPRITE = [
  '......T.....',
  '......A.....',
  '...SSSSSS...',
  '..SBBBBBBS..',
  '.SBBBBBBBBS.',
  '.SBEEBBEEBS.',
  '.SBGEBBGEBS.',
  '.SBBBBBBBBS.',
  '.SBLLLLLLBS.',
  '.SBLLLLLLBS.',
  '.SBBBBBBBBS.',
  '..SBBBBBBS..',
  '...FF..FF...',
];

const LED_COLORS = {
  B: color('#ff6a3d'),
  S: color('#ff6a3d', 0.32),
  L: color('#5ad19a'),
  E: color('#0e0a08', 0.8),
  G: color('#ffffff'),
  A: color('#5ad19a', 0.85),
  T: color('#eafff2'),
  F: color('#ff6a3d', 0.32),
};

/** v11 Dock — soft LED dots (larger, closer, light glow on tip only). */
function drawAuriLed(img, size, { onAir = false } = {}) {
  const rows = SPRITE.length;
  const cols = 12;
  const rd = size * 0.0265;
  const gap = size * 0.0035;
  const step = rd * 2 + gap;
  const ox = size * 0.5 - (cols * step - gap) / 2;
  const oy = size * 0.53 - (rows * step - gap) / 2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < SPRITE[row].length; col++) {
      const ch = SPRITE[row][col];
      if (ch === '.') continue;
      const cx = ox + col * step + rd;
      const cy = oy + row * step + rd;
      if (ch === 'T') radialGlow(img, cx, cy, rd * 1.5, color('#5ad19a', 0.25));
      fillEllipse(img, cx, cy, rd, rd, LED_COLORS[ch]);
    }
  }

  if (onAir) {
    const topY = oy - step * 0.3;
    const cx = size * 0.5;
    const r = step * 4.0 * 0.32;
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const ang = Math.PI * (0.22 + 0.56 * i / Math.max(1, steps - 1));
      fillEllipse(
        img,
        cx + Math.cos(ang) * r,
        topY - Math.sin(ang) * r * 0.48,
        rd * 0.58,
        rd * 0.58,
        color('#5ad19a', 0.9),
      );
    }
  }
}

/** Menu bar — solid Auri silhouette (macOS template black). */
function drawTraySilhouette(img, size, { onAir = false } = {}) {
  const u = size / 22;
  const ink = color('#000000', 0.92);
  fillRoundedRect(img, 10.5 * u, 2 * u, 1 * u, 3.5 * u, 0.5 * u, ink);
  fillEllipse(img, 11 * u, 1.8 * u, 1.3 * u, 1.3 * u, ink);
  fillRoundedRect(img, 6 * u, 6 * u, 10 * u, 9.5 * u, 2.8 * u, ink);
  fillEllipse(img, 8.5 * u, 16.8 * u, 1.1 * u, 1.1 * u, ink);
  fillEllipse(img, 13.5 * u, 16.8 * u, 1.1 * u, 1.1 * u, ink);
  if (onAir) fillEllipse(img, 11 * u, 0.8 * u, 0.95 * u, 0.95 * u, ink);
}

function renderDockIcon(size, { onAir = false } = {}) {
  const img = image(size);
  const s = size / 1024;
  const sx = (v) => v * s;
  const top = color('#46403a');
  const mid = color('#403a35');
  const bottom = color('#3a3430');

  fillRoundedRect(img, sx(56), sx(56), sx(912), sx(912), sx(206), (x, y) => {
    const t = y / size;
    if (t < 0.5) return mix(top, mid, t / 0.5);
    return mix(mid, bottom, (t - 0.5) / 0.5);
  });
  fillRoundedRect(img, sx(76), sx(76), sx(872), sx(872), sx(184), color('#ffffff', 0.03));

  for (let y = 120; y < 900; y += 67) {
    for (let x = 120; x < 900; x += 67) {
      fillEllipse(img, sx(x), sx(y), sx(1.8), sx(1.8), color('#ffffff', 0.025));
    }
  }

  radialGlow(img, sx(512), sx(574), sx(388), color('#ff6a3d', 0.13));
  radialGlow(img, sx(389), sx(205), sx(461), color('#ffdcb8', 0.12));

  drawAuriLed(img, size, { onAir });

  fillRoundedRect(img, sx(56), sx(56), sx(912), sx(912), sx(206), color('#ffffff', 0.04));
  return img;
}

function renderTrayIcon(size, { onAir = false } = {}) {
  const img = image(size);
  drawTraySilhouette(img, size, { onAir });
  return img;
}

function resizeImage(src, size) {
  const out = image(size);
  const scaleX = src.width / size;
  const scaleY = src.height / size;
  for (let y = 0; y < size; y++) {
    const sy = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const ty = sy - y0;
    for (let x = 0; x < size; x++) {
      const sx = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const tx = sx - x0;
      const dst = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src.pixels[(y0 * src.width + x0) * 4 + c];
        const p10 = src.pixels[(y0 * src.width + x1) * 4 + c];
        const p01 = src.pixels[(y1 * src.width + x0) * 4 + c];
        const p11 = src.pixels[(y1 * src.width + x1) * 4 + c];
        out.pixels[dst + c] = Math.round((p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty);
      }
    }
  }
  return out;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const crcTable = makeCrcTable();

function crc32(buffers) {
  let c = 0xffffffff;
  for (const buffer of buffers) for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32([name, data]), 8 + data.length);
  return out;
}

function encodePng(img) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(img.width, 0);
  header.writeUInt32BE(img.height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(6, 9);
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    img.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([signature, pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND')]);
}

function writePng(file, img) {
  fs.writeFileSync(file, encodePng(img));
}

function writeIco(file, images) {
  let offset = 6 + images.length * 16;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  fs.writeFileSync(file, Buffer.concat([header, ...entries, ...images.map((item) => item.data)]));
}

function writeIcns(file, images) {
  const chunks = images.map(({ type, data }) => {
    const out = Buffer.alloc(8 + data.length);
    out.write(type, 0, 4, 'ascii');
    out.writeUInt32BE(out.length, 4);
    data.copy(out, 8);
    return out;
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((total, item) => total + item.length, 0), 4);
  fs.writeFileSync(file, Buffer.concat([header, ...chunks]));
}

fs.mkdirSync(outDir, { recursive: true });

const master = renderDockIcon(1024, { onAir: false });
writePng(path.join(outDir, 'icon.png'), master);
writePng(path.join(outDir, 'trayTemplate.png'), renderTrayIcon(44, { onAir: false }));
writePng(path.join(outDir, 'trayOnAir.png'), renderTrayIcon(44, { onAir: true }));

const iconset = new Map(
  [16, 32, 64, 128, 256, 512, 1024].map((size) => [size, encodePng(size === 1024 ? master : resizeImage(master, size))]),
);

writeIcns(path.join(outDir, 'icon.icns'), [
  { type: 'icp4', data: iconset.get(16) },
  { type: 'icp5', data: iconset.get(32) },
  { type: 'icp6', data: iconset.get(64) },
  { type: 'ic07', data: iconset.get(128) },
  { type: 'ic08', data: iconset.get(256) },
  { type: 'ic09', data: iconset.get(512) },
  { type: 'ic10', data: iconset.get(1024) },
]);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
writeIco(path.join(outDir, 'icon.ico'), icoSizes.map((size) => ({ size, data: encodePng(resizeImage(master, size)) })));

console.log('Generated build/icon.png, build/icon.icns, build/icon.ico, build/trayTemplate.png, build/trayOnAir.png');
