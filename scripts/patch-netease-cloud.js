import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('node_modules', 'NeteaseCloudMusicApi', 'module', 'cloud.js');

if (!fs.existsSync(file)) process.exit(0);

const original = fs.readFileSync(file, 'utf8');
if (!original.includes("const mm = require('music-metadata')")) process.exit(0);

const patched = original
  .replace(
    "const mm = require('music-metadata')\n",
    [
      'let mmPromise = null',
      'async function parseMusicMetadata(buffer, mimetype) {',
      "  mmPromise ||= import('music-metadata')",
      '  const mm = await mmPromise',
      '  return mm.parseBuffer(buffer, mimetype)',
      '}',
      '',
    ].join('\n'),
  )
  .replace(
    'const metadata = await mm.parseBuffer(\n      query.songFile.data,\n      query.songFile.mimetype,\n    )',
    'const metadata = await parseMusicMetadata(\n      query.songFile.data,\n      query.songFile.mimetype,\n    )',
  );

fs.writeFileSync(file, patched);
console.log('[postinstall] patched NeteaseCloudMusicApi cloud metadata loader');
