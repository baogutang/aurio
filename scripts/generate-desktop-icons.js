import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
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

function drawLine(img, x1, y1, x2, y2, width, paint) {
  const minX = Math.floor(Math.min(x1, x2) - width - 2);
  const maxX = Math.ceil(Math.max(x1, x2) + width + 2);
  const minY = Math.floor(Math.min(y1, y2) - width - 2);
  const maxY = Math.ceil(Math.max(y1, y2) + width + 2);
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy || 1;
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const t = clamp(((px + 0.5 - x1) * vx + (py + 0.5 - y1) * vy) / len2);
      const dx = px + 0.5 - (x1 + vx * t);
      const dy = py + 0.5 - (y1 + vy * t);
      const d = Math.hypot(dx, dy) - width / 2;
      const coverage = clamp(0.8 - d);
      if (coverage > 0) blendPixel(img, px, py, typeof paint === 'function' ? paint(px, py) : paint, coverage);
    }
  }
}

function drawArc(img, cx, cy, rx, ry, start, end, width, paint) {
  const steps = Math.max(24, Math.round(Math.abs(end - start) * Math.max(rx, ry) / 10));
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const t = start + (end - start) * (i / steps);
    const p = { x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry };
    if (prev) drawLine(img, prev.x, prev.y, p.x, p.y, width, paint);
    prev = p;
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

function renderIcon(size) {
  const img = image(size);
  const s = size / 1024;
  const sx = (v) => v * s;
  const top = color('#1d2124');
  const bottom = color('#070909');
  const green = color('#76f3ad');
  const orange1 = color('#ff9a35');
  const orange2 = color('#ff642f');

  fillRoundedRect(img, sx(56), sx(56), sx(912), sx(912), sx(206), (x, y) => mix(top, bottom, y / size));
  fillRoundedRect(img, sx(76), sx(76), sx(872), sx(872), sx(184), color('#ffffff', 0.035));
  radialGlow(img, sx(512), sx(315), sx(345), color('#65f0a0', 0.34));
  radialGlow(img, sx(512), sx(650), sx(360), color('#ff6a3d', 0.13));

  for (let y = 128; y < 900; y += 54) {
    for (let x = 128; x < 900; x += 54) fillEllipse(img, sx(x), sx(y), sx(4), sx(4), color('#ffffff', 0.055));
  }

  drawArc(img, sx(512), sx(313), sx(138), sx(100), Math.PI * 1.05, Math.PI * 1.95, sx(15), color('#9cffc5', 0.86));
  drawArc(img, sx(512), sx(310), sx(210), sx(154), Math.PI * 1.07, Math.PI * 1.93, sx(13), color('#6df0a4', 0.50));
  drawArc(img, sx(512), sx(306), sx(280), sx(205), Math.PI * 1.1, Math.PI * 1.9, sx(10), color('#5ad19a', 0.28));

  drawLine(img, sx(512), sx(430), sx(512), sx(330), sx(21), color('#7df5ae', 0.92));
  fillEllipse(img, sx(512), sx(303), sx(39), sx(39), color('#eafff2', 1));
  fillEllipse(img, sx(512), sx(303), sx(22), sx(22), color('#5dff9e', 0.9));

  fillEllipse(img, sx(512), sx(642), sx(248), sx(250), (x, y) => mix(orange1, orange2, clamp((y - sx(440)) / sx(430))));
  fillEllipse(img, sx(333), sx(657), sx(82), sx(118), color('#ff6937', 0.98));
  fillEllipse(img, sx(691), sx(657), sx(82), sx(118), color('#ff6937', 0.98));
  fillRoundedRect(img, sx(396), sx(807), sx(90), sx(82), sx(30), color('#fa5b2a', 1));
  fillRoundedRect(img, sx(538), sx(807), sx(90), sx(82), sx(30), color('#fa5b2a', 1));

  fillEllipse(img, sx(512), sx(690), sx(150), sx(108), (x, y) => mix(color('#a1ffd1'), color('#43d79a'), clamp((y - sx(585)) / sx(215))));
  fillEllipse(img, sx(512), sx(690), sx(116), sx(76), color('#baffdd', 0.34));

  fillEllipse(img, sx(420), sx(575), sx(42), sx(52), color('#140f0c', 0.96));
  fillEllipse(img, sx(604), sx(575), sx(42), sx(52), color('#140f0c', 0.96));
  fillEllipse(img, sx(433), sx(557), sx(12), sx(14), color('#ffffff', 0.96));
  fillEllipse(img, sx(617), sx(557), sx(12), sx(14), color('#ffffff', 0.96));
  drawLine(img, sx(486), sx(632), sx(507), sx(651), sx(12), color('#22130c', 0.95));
  drawLine(img, sx(507), sx(651), sx(538), sx(651), sx(12), color('#22130c', 0.95));
  drawLine(img, sx(538), sx(651), sx(559), sx(632), sx(12), color('#22130c', 0.95));

  fillRoundedRect(img, sx(56), sx(56), sx(912), sx(912), sx(206), color('#ffffff', 0.04));
  drawLine(img, sx(190), sx(920), sx(834), sx(920), sx(10), color('#ffffff', 0.045));
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

const master = renderIcon(1024);
writePng(path.join(outDir, 'icon.png'), master);

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

console.log('Generated build/icon.png, build/icon.icns, and build/icon.ico');
