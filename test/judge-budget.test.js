// Per-show length budgets in the judge (P2 节目表): sayMax/segueMax tighten the
// defaults for a programme (深夜航班 wants shorter lines); maxLen still wins;
// the defaults are untouched when no override is given.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let tmpDir;
let judgeSay;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-judge-budget-'));
  process.env.AURIO_DATA_DIR = tmpDir;
  const url = pathToFileURL(path.resolve('server/agent/judge.js')).href;
  ({ judgeSay } = await import(`${url}?t=${Date.now()}`));
});

afterAll(() => {
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const zi = (n) => '字'.repeat(n);

describe('per-show judge budget overrides', () => {
  it('sayMax tightens the say budget', () => {
    expect(judgeSay(zi(40), { sayMax: 40, skipRepeat: true }).ok).toBe(true);
    const over = judgeSay(zi(41), { sayMax: 40, skipRepeat: true });
    expect(over.ok).toBe(false);
    expect(over.violations).toContainEqual({ code: 'too_long', detail: '41/40' });
  });

  it('segueMax tightens the segue budget', () => {
    expect(judgeSay(zi(30), { segue: true, segueMax: 30, skipRepeat: true }).ok).toBe(true);
    const over = judgeSay(zi(31), { segue: true, segueMax: 30, skipRepeat: true });
    expect(over.violations.map((v) => v.code)).toContain('too_long');
  });

  it('sayMax does not leak into segue judging and vice versa', () => {
    // A 41-char segue against the default 45 budget: sayMax must not apply.
    expect(judgeSay(zi(41), { segue: true, sayMax: 40, skipRepeat: true }).ok).toBe(true);
    // A 50-char say against the default 60 budget: segueMax must not apply.
    expect(judgeSay(zi(50), { segueMax: 30, skipRepeat: true }).ok).toBe(true);
  });

  it('an explicit maxLen still wins over the show budgets', () => {
    expect(judgeSay(zi(50), { sayMax: 40, maxLen: 55, skipRepeat: true }).ok).toBe(true);
    expect(judgeSay(zi(56), { sayMax: 40, maxLen: 55, skipRepeat: true }).ok).toBe(false);
  });

  it('defaults are unchanged when no override is given', () => {
    expect(judgeSay(zi(60), { skipRepeat: true }).ok).toBe(true);
    expect(judgeSay(zi(61), { skipRepeat: true }).ok).toBe(false);
    expect(judgeSay(zi(45), { segue: true, skipRepeat: true }).ok).toBe(true);
    expect(judgeSay(zi(46), { segue: true, skipRepeat: true }).ok).toBe(false);
  });
});
