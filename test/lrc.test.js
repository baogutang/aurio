import { describe, it, expect } from 'vitest';
import { parseLrc, plainLines, mergeTranslation } from '../server/music/lrc.js';

describe('parseLrc', () => {
  it('parses timestamps with fractional seconds', () => {
    expect(parseLrc('[00:12.50]Hello\n[01:05]World')).toEqual([
      { time: 12.5, text: 'Hello' },
      { time: 65, text: 'World' },
    ]);
  });

  it('expands multi-stamp lines and sorts by time', () => {
    expect(parseLrc('[00:03]Hey\n[00:01]Hey')).toEqual([
      { time: 1, text: 'Hey' },
      { time: 3, text: 'Hey' },
    ]);
  });

  it('skips metadata/empty lines', () => {
    expect(parseLrc('[ar:Adele]\n[00:01]Hi\n[00:02]')).toEqual([
      { time: 1, text: 'Hi' },
    ]);
  });
});

describe('plainLines', () => {
  it('returns one untimed entry per non-empty line', () => {
    expect(plainLines('a\n\n  b ')).toEqual([
      { time: null, text: 'a' },
      { time: null, text: 'b' },
    ]);
  });
});

describe('mergeTranslation', () => {
  it('attaches translations onto lines with a matching timestamp', () => {
    const lines = parseLrc('[00:01]Hello\n[00:02]World');
    const merged = mergeTranslation(lines, '[00:01]你好');
    expect(merged[0]).toEqual({ time: 1, text: 'Hello', tr: '你好' });
    expect(merged[1]).toEqual({ time: 2, text: 'World' });
  });
});
