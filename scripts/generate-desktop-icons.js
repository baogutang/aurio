import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sourcePath = path.join(root, 'pwa', 'aurio-logo.png');
const outDir = path.join(root, 'build');
const iconsetDir = path.join(outDir, 'icon.iconset');

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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
  for (const buffer of buffers) {
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32([name, data]), 8 + data.length);
  return out;
}

function decodePng(file) {
  const input = fs.readFileSync(file);
  if (!input.subarray(0, 8).equals(signature)) throw new Error(`Not a PNG: ${file}`);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.subarray(offset + 4, offset + 8).toString('ascii');
    const data = input.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
        throw new Error('Only non-interlaced 8-bit RGB/RGBA PNG files are supported');
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  let rawOffset = 0;
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[rawOffset++];
    const row = Buffer.from(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;

    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 0xff;
      else if (filter === 2) row[x] = (row[x] + up) & 0xff;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, upLeft)) & 0xff;
      else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}`);
    }

    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      pixels[dst] = row[src];
      pixels[dst + 1] = row[src + 1];
      pixels[dst + 2] = row[src + 2];
      pixels[dst + 3] = channels === 4 ? row[src + 3] : 255;
    }
    prev = row;
  }

  return { width, height, pixels };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function resizeCropSquare(image, size) {
  const sourceSize = Math.min(image.width, image.height);
  const offsetX = Math.floor((image.width - sourceSize) / 2);
  const offsetY = Math.floor((image.height - sourceSize) / 2);
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    const sy = offsetY + Math.min(sourceSize - 1, Math.floor((y / size) * sourceSize));
    for (let x = 0; x < size; x++) {
      const sx = offsetX + Math.min(sourceSize - 1, Math.floor((x / size) * sourceSize));
      const src = (sy * image.width + sx) * 4;
      const dst = (y * size + x) * 4;
      out[dst] = image.pixels[src];
      out[dst + 1] = image.pixels[src + 1];
      out[dst + 2] = image.pixels[src + 2];
      out[dst + 3] = image.pixels[src + 3];
    }
  }

  return { width: size, height: size, pixels: out };
}

function encodePng(image) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(6, 9);
  header.writeUInt8(0, 10);
  header.writeUInt8(0, 11);
  header.writeUInt8(0, 12);

  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0;
    image.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND'),
  ]);
}

function writePng(file, image) {
  fs.writeFileSync(file, encodePng(image));
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
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  fs.writeFileSync(file, Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
}

function writeIcns(file, images) {
  const chunks = images.map(({ type, data }) => {
    const name = Buffer.from(type, 'ascii');
    const out = Buffer.alloc(8 + data.length);
    name.copy(out, 0);
    out.writeUInt32BE(out.length, 4);
    data.copy(out, 8);
    return out;
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((total, item) => total + item.length, 0), 4);
  fs.writeFileSync(file, Buffer.concat([header, ...chunks]));
}

fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const source = decodePng(sourcePath);
const icon1024 = resizeCropSquare(source, 1024);
writePng(path.join(outDir, 'icon.png'), icon1024);

const iconset = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

for (const [size, name] of iconset) writePng(path.join(iconsetDir, name), resizeCropSquare(source, size));

writeIcns(path.join(outDir, 'icon.icns'), [
  { type: 'icp4', data: fs.readFileSync(path.join(iconsetDir, 'icon_16x16.png')) },
  { type: 'icp5', data: fs.readFileSync(path.join(iconsetDir, 'icon_32x32.png')) },
  { type: 'icp6', data: fs.readFileSync(path.join(iconsetDir, 'icon_32x32@2x.png')) },
  { type: 'ic07', data: fs.readFileSync(path.join(iconsetDir, 'icon_128x128.png')) },
  { type: 'ic08', data: fs.readFileSync(path.join(iconsetDir, 'icon_256x256.png')) },
  { type: 'ic09', data: fs.readFileSync(path.join(iconsetDir, 'icon_512x512.png')) },
  { type: 'ic10', data: fs.readFileSync(path.join(iconsetDir, 'icon_512x512@2x.png')) },
]);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
writeIco(
  path.join(outDir, 'icon.ico'),
  icoSizes.map((size) => ({ size, data: encodePng(resizeCropSquare(source, size)) })),
);

fs.rmSync(iconsetDir, { recursive: true, force: true });
console.log('Generated build/icon.png, build/icon.icns, and build/icon.ico');
