import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

describe('store flushSave', () => {
  it('writes state immediately on flush', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-store-'));
    process.env.AURIO_DATA_DIR = tmpDir;
    try {
      const storeUrl = pathToFileURL(path.resolve('server/store.js')).href;
      const bust = `${storeUrl}?t=${Date.now()}`;
      const { load, db, flushSave } = await import(bust);
      load();
      db.setPref('probe', 'ok');
      flushSave();
      const file = path.join(tmpDir, 'data', 'state.json');
      expect(fs.existsSync(file)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(saved.prefs.probe).toBe('ok');
    } finally {
      delete process.env.AURIO_DATA_DIR;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
