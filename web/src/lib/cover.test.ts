import { describe, it, expect } from 'vitest';
import { coverUrl } from './cover';

describe('coverUrl', () => {
  it('returns null for missing tracks', () => {
    expect(coverUrl(null)).toBeNull();
    expect(coverUrl(undefined)).toBeNull();
  });

  it('returns null when source or id is missing/empty', () => {
    expect(coverUrl({ source: 'netease', id: '' })).toBeNull();
    expect(coverUrl({ source: '' as never, id: '42' })).toBeNull();
  });

  it('builds a same-origin server URL from source and id', () => {
    expect(coverUrl({ source: 'netease', id: '12345' })).toBe('/api/cover/netease/12345');
    expect(coverUrl({ source: 'qqmusic', id: 'abc' })).toBe('/api/cover/qqmusic/abc');
  });

  it('URL-encodes ids that contain path or query characters', () => {
    // Navidrome ids can be opaque strings; slashes and spaces must not break routing.
    expect(coverUrl({ source: 'navidrome', id: 'al/12 3?x=1' })).toBe(
      '/api/cover/navidrome/al%2F12%203%3Fx%3D1',
    );
  });
});
