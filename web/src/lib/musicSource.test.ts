import { describe, it, expect } from 'vitest';
import {
  availableSourceModes,
  nextMusicSource,
  labelForSource,
  servicesFromModes,
  hintForSources,
  type MusicServices,
} from './musicSource';

// Identity translator: label assertions become locale-independent key checks.
const idT = (k: string) => k;

const none: MusicServices = { netease: false, navidrome: false };
const all: MusicServices = { netease: true, navidrome: true, qqmusic: true };
const neteaseOnly: MusicServices = { netease: true, navidrome: false };
const nasOnly: MusicServices = { netease: false, navidrome: true };

describe('availableSourceModes', () => {
  it('returns nothing when no service is live', () => {
    expect(availableSourceModes(none)).toEqual([]);
  });

  it('always offers "combined" first when at least one service is live — even a single one', () => {
    expect(availableSourceModes(neteaseOnly)).toEqual(['combined', 'netease']);
    expect(availableSourceModes(nasOnly)).toEqual(['combined', 'navidrome']);
  });

  it('lists all live services in fixed order: combined, netease, navidrome, qqmusic', () => {
    expect(availableSourceModes(all)).toEqual(['combined', 'netease', 'navidrome', 'qqmusic']);
  });

  it('treats a missing qqmusic flag as not live', () => {
    expect(availableSourceModes({ netease: true, navidrome: true })).toEqual([
      'combined',
      'netease',
      'navidrome',
    ]);
  });
});

describe('nextMusicSource', () => {
  it('cycles through all live modes and wraps around', () => {
    expect(nextMusicSource('combined', all)).toBe('netease');
    expect(nextMusicSource('netease', all)).toBe('navidrome');
    expect(nextMusicSource('navidrome', all)).toBe('qqmusic');
    expect(nextMusicSource('qqmusic', all)).toBe('combined');
  });

  it('returns the current mode unchanged when no service is live', () => {
    expect(nextMusicSource('netease', none)).toBe('netease');
    expect(nextMusicSource('combined', none)).toBe('combined');
  });

  it('treats a current mode that is no longer available as position 0 and advances from there', () => {
    // Characterization: indexOf(-1) is clamped to 0, so the "next" source is
    // the second available option, not the first.
    expect(nextMusicSource('netease', nasOnly)).toBe('navidrome');
  });

  it('toggles between combined and the single live service', () => {
    expect(nextMusicSource('combined', neteaseOnly)).toBe('netease');
    expect(nextMusicSource('netease', neteaseOnly)).toBe('combined');
  });
});

describe('labelForSource', () => {
  it('labels "not configured" when nothing is live, regardless of mode', () => {
    expect(labelForSource('combined', none, idT)).toBe('sourceNone');
    expect(labelForSource('netease', none, idT)).toBe('sourceNone');
  });

  it('labels each live mode with its own key', () => {
    expect(labelForSource('combined', all, idT)).toBe('sourceCombined');
    expect(labelForSource('netease', all, idT)).toBe('sourceNetease');
    expect(labelForSource('navidrome', all, idT)).toBe('sourceNas');
    expect(labelForSource('qqmusic', all, idT)).toBe('sourceQQ');
  });

  it('falls back to the combined label when the mode names a service that is not live', () => {
    // Characterization: a stale mode (e.g. netease after logout) displays as
    // "combined" as long as anything else is still live.
    expect(labelForSource('netease', nasOnly, idT)).toBe('sourceCombined');
    expect(labelForSource('qqmusic', neteaseOnly, idT)).toBe('sourceCombined');
  });
});

describe('servicesFromModes', () => {
  it('maps an empty (or omitted) mode list to all-off', () => {
    expect(servicesFromModes([])).toEqual({ netease: false, navidrome: false, qqmusic: false });
    expect(servicesFromModes()).toEqual({ netease: false, navidrome: false, qqmusic: false });
  });

  it('flags exactly the listed services and ignores "combined"', () => {
    expect(servicesFromModes(['combined', 'netease', 'qqmusic'])).toEqual({
      netease: true,
      navidrome: false,
      qqmusic: true,
    });
  });
});

describe('hintForSources', () => {
  it('returns undefined when there is at most one selectable mode', () => {
    expect(hintForSources(none, idT)).toBeUndefined();
  });

  it('joins available labels behind the localized prefix', () => {
    expect(hintForSources(all, idT)).toBe(
      'sourceHintPrefixsourceCombined / sourceNetease / sourceNas / sourceQQ',
    );
  });

  it('includes combined + the single service when only one source is live', () => {
    expect(hintForSources(neteaseOnly, idT)).toBe('sourceHintPrefixsourceCombined / sourceNetease');
  });
});
