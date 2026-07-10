import { authHeaders } from './api';

export type MusicSourceMode = 'combined' | 'netease' | 'navidrome' | 'qqmusic';
export type MusicServices = { netease: boolean; navidrome: boolean; qqmusic?: boolean };
type SourceLabelKey =
  | 'sourceCombined' | 'sourceNetease' | 'sourceNas' | 'sourceQQ' | 'sourceNone'
  | 'sourceHintPrefix';

function liveCount(svc: MusicServices) {
  return Number(!!svc.netease) + Number(!!svc.navidrome) + Number(!!svc.qqmusic);
}

export function availableSourceModes(svc: MusicServices): MusicSourceMode[] {
  const opts: MusicSourceMode[] = [];
  if (liveCount(svc) > 0) opts.push('combined');
  if (svc.netease) opts.push('netease');
  if (svc.navidrome) opts.push('navidrome');
  if (svc.qqmusic) opts.push('qqmusic');
  return opts;
}

export function nextMusicSource(
  current: MusicSourceMode,
  svc: MusicServices,
): MusicSourceMode {
  const opts = availableSourceModes(svc);
  if (!opts.length) return current;
  const i = Math.max(0, opts.indexOf(current));
  return opts[(i + 1) % opts.length];
}

export async function postMusicSource(source: MusicSourceMode): Promise<{ ok: boolean; musicSource?: MusicSourceMode }> {
  const r = await fetch('/api/music-source', {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ source }),
  });
  return r.json();
}

export function labelForSource(
  mode: MusicSourceMode,
  svc: MusicServices,
  t: (k: SourceLabelKey) => string,
): string {
  if (liveCount(svc) === 0) return t('sourceNone');
  if (mode === 'combined') return t('sourceCombined');
  if (mode === 'netease' && svc.netease) return t('sourceNetease');
  if (mode === 'navidrome' && svc.navidrome) return t('sourceNas');
  if (mode === 'qqmusic' && svc.qqmusic) return t('sourceQQ');
  // A stale mode (e.g. netease after logout) displays as combined.
  return t('sourceCombined');
}

export function servicesFromModes(modes: MusicSourceMode[] = []): MusicServices {
  return {
    netease: modes.includes('netease'),
    navidrome: modes.includes('navidrome'),
    qqmusic: modes.includes('qqmusic'),
  };
}

export function hintForSources(
  svc: MusicServices,
  t: (k: SourceLabelKey) => string,
): string | undefined {
  const labels = availableSourceModes(svc).map((mode) => labelForSource(mode, svc, t));
  return labels.length > 1 ? `${t('sourceHintPrefix')}${labels.join(' / ')}` : undefined;
}
