import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MainCard from './components/MainCard';
import ChatSheet from './components/ChatSheet';
import SettingsModal from './components/SettingsModal';
import Onboarding, { type OnboardGroup } from './components/Onboarding';
import WidgetShell from './components/WidgetShell';
import StatusStrip from './components/StatusStrip';
import PressButton from './components/PressButton';
import PixelPet, { type PetState } from './components/PixelPet';
import { IconChat, IconSettings, IconPrev, IconNext, IconPlay, IconPause } from './components/icons';
import { api, fmt, setWsClientId } from './lib/api';
import { mergeQueueWhilePlaying } from './lib/queueSync';
import { formatNow, type NowDisplay } from './lib/dateFormat';
import { nextMusicSource, postMusicSource, servicesFromModes, type MusicSourceMode, type MusicServices } from './lib/musicSource';
import { spring, stagger } from './lib/motion';
import { cleanSayText } from './lib/highlight';
import { dedupeQueue } from './lib/queue';
import { useI18n, usePreferences } from './context/PreferencesContext';
import type { Track, Broadcast, ChatMsg, TtsPatch } from './lib/types';

const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export default function App() {
  const { t, localeTag, locale } = useI18n();
  const { resolved, setTheme } = usePreferences();
  const audioRef = useRef<HTMLAudioElement>(null);
  const ttsRef = useRef<HTMLAudioElement>(null);
  const queueRef = useRef<Track[]>([]);
  const idxRef = useRef(-1);
  const scrobbled = useRef(false);
  const lastBroadcastTs = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const audioPrimed = useRef(false);
  const playbackRecoveryTimer = useRef<number | undefined>(undefined);
  const skipTimerRef = useRef<number | undefined>(undefined);
  const queueRevisionRef = useRef(0);
  const errorTrackUrlRef = useRef<string | null>(null);
  const clientIdRef = useRef('');
  const reconnectDelayRef = useRef(1000);
  const autoPlayUserInitRef = useRef(false);
  const segueActiveRef = useRef(false);
  const pendingIdleStartRef = useRef<{ q: Track[]; idx: number } | null>(null);

  const pendingIdleTimerRef = useRef<number | undefined>(undefined);

  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [segueActive, setSegueActive] = useState(false);
  const [clientRole, setClientRole] = useState<'unknown' | 'controller' | 'observer'>('unknown');
  const [feedbackHint, setFeedbackHint] = useState('');
  const [tasteLine, setTasteLine] = useState('');
  const [planNote, setPlanNote] = useState('');
  const [likedKey, setLikedKey] = useState('');
  const [progress, setProgress] = useState(0);
  const [cur, setCur] = useState('0:00');
  const [dur, setDur] = useState('0:00');
  const [say, setSay] = useState('');
  const [conn, setConn] = useState<'on' | 'busy' | ''>('');
  const [now, setNow] = useState<NowDisplay>({ time: '--:--', weekday: '', dateLine: '' });
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsGroup, setSettingsGroup] = useState<OnboardGroup | undefined>(undefined);
  const [onboard, setOnboard] = useState(false);
  const [services, setServices] = useState<MusicServices & { weather: boolean }>({ netease: false, navidrome: false, qqmusic: false, weather: false });
  const [musicSource, setMusicSource] = useState<MusicSourceMode>('combined');
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [queue, setQueue] = useState<Track[]>([]);

  const isController = clientRole === 'controller';

  const syncQueueState = useCallback((q: Track[], idx: number) => {
    const clean = dedupeQueue(q, idx);
    const withUid = clean.queue.map((tk) =>
      tk.uid ? tk : { ...tk, uid: `${tk.source}:${tk.id}:${Math.random().toString(36).slice(2, 8)}` }
    );
    queueRef.current = withUid;
    idxRef.current = clean.index;
    setQueue(withUid);
    setQueueTotal(withUid.length);
    setQueueIndex(clean.index);
  }, []);

  const syncFromServer = useCallback((serverQ: Track[], rev: number, playingIdx = idxRef.current) => {
    if (typeof rev === 'number') queueRevisionRef.current = rev;
    const playingNow = playingIdx >= 0 && !audioRef.current?.paused;
    if (!playingNow) {
      syncQueueState(serverQ, playingIdx >= 0 && playingIdx < serverQ.length ? playingIdx : -1);
      return;
    }
    const merged = mergeQueueWhilePlaying(queueRef.current, serverQ, playingIdx);
    syncQueueState(merged, playingIdx);
  }, [syncQueueState]);

  const queueRemaining = queueIndex >= 0
    ? Math.max(0, queueTotal - queueIndex - 1)
    : queueTotal;

  // Queue edits from the player UI (reorder / remove / clear). Update the live
  // refs + state, then persist so a reload keeps the user's edits.
  const reconcileQueue = useCallback(async () => {
    try {
      const snap = await api.getQueue();
      if (typeof snap.revision === 'number') queueRevisionRef.current = snap.revision;
      if (Array.isArray(snap.queue)) {
        const idx = Math.min(Math.max(idxRef.current, -1), snap.queue.length - 1);
        syncQueueState(snap.queue, idx);
      }
    } catch { /* noop */ }
  }, [syncQueueState]);

  const applyQueueEdit = useCallback((q: Track[], idx: number) => {
    if (!isController) return;
    const clean = dedupeQueue(q, idx);
    queueRef.current = clean.queue;
    idxRef.current = clean.index;
    setQueue(clean.queue);
    setQueueTotal(clean.queue.length);
    setQueueIndex(clean.index);
    api.setQueue(clean.queue, queueRevisionRef.current).then(async (r) => {
      if (typeof r?.revision === 'number') queueRevisionRef.current = r.revision;
    }).catch(async (err: Error & { status?: number }) => {
      if (err?.status === 403) return;
      await reconcileQueue();
      api.setQueue(queueRef.current, queueRevisionRef.current).then((r) => {
        if (typeof r?.revision === 'number') queueRevisionRef.current = r.revision;
      }).catch(() => {});
    });
  }, [reconcileQueue, isController]);

  const reorderUpNext = useCallback((nextUpcoming: Track[]) => {
    const idx = idxRef.current;
    applyQueueEdit([...queueRef.current.slice(0, idx + 1), ...nextUpcoming], idx);
  }, [applyQueueEdit]);

  const removeAt = useCallback((index: number) => {
    const q = queueRef.current.filter((_, i) => i !== index);
    const idx = index < idxRef.current ? idxRef.current - 1 : idxRef.current;
    applyQueueEdit(q, idx);
  }, [applyQueueEdit]);

  const clearUpNext = useCallback(() => {
    const idx = idxRef.current;
    applyQueueEdit(queueRef.current.slice(0, idx + 1), idx);
  }, [applyQueueEdit]);

  const reportState = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === 1) {
      const tr = queueRef.current[idxRef.current];
      ws.send(JSON.stringify({
        type: 'state',
        playingIndex: idxRef.current,
        paused: audioRef.current?.paused ?? true,
        queueLen: queueRef.current.length,
        queueRevision: queueRevisionRef.current,
        currentTrack: tr ? { id: tr.id, title: tr.title, artist: tr.artist, source: tr.source } : null,
      }));
    }
  }, []);

  const primeAudio = useCallback(() => {
    if (audioPrimed.current) return;
    const prime = (el: HTMLAudioElement | null) => {
      if (!el || !el.paused || el.getAttribute('src')) return Promise.resolve(false);
      const prevVolume = el.volume;
      el.volume = 0;
      el.src = SILENT_WAV;
      return el.play()
        .then(() => {
          el.pause();
          el.removeAttribute('src');
          el.load();
          el.volume = prevVolume;
          return true;
        })
        .catch(() => {
          el.volume = prevVolume;
          return false;
        });
    };
    Promise.all([prime(audioRef.current), prime(ttsRef.current)]).then(() => {
      audioPrimed.current = true;
    });
  }, []);

  useEffect(() => {
    setSay(t('sayDefault'));
  }, [t]);

  useEffect(() => {
    const tick = () => setNow(formatNow(new Date(), locale, localeTag));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [locale, localeTag]);

  const playTrack = useCallback((tr: Track, idx: number) => {
    if (!tr?.url) return;
    clearPlaybackRecovery();
    scrobbled.current = false;
    setCurrent(tr);
    setQueueIndex(idx);
    idxRef.current = idx;
    if (tr.segue) setSay(tr.segue);

    const a = audioRef.current!;
    const startSong = () => {
      segueActiveRef.current = false;
      setSegueActive(false);
      a.src = tr.url!;
      a.volume = 1;
      api.playbackEvent({
        event: 'started',
        track: { id: tr.id, title: tr.title, artist: tr.artist, source: tr.source },
        queue_index: idx,
      }).catch(() => {});
      a.play()
        .then(() => reportState())
        .catch(() => {
          setPlaying(false);
          if (autoPlayUserInitRef.current) setSay(t('sayTapPlay'));
          reportState();
        });
    };

    if (tr.segueTtsUrl && ttsRef.current) {
      const tts = ttsRef.current;
      const dimMusic = !!(a.src && !a.paused);
      segueActiveRef.current = true;
      setSegueActive(true);
      if (dimMusic) a.volume = 0.12;
      let done = false;
      let guard: number | undefined;
      const finish = () => {
        if (done) return;
        done = true;
        if (guard) window.clearTimeout(guard);
        tts.onended = null;
        tts.onerror = null;
        startSong();
      };
      tts.onended = finish;
      tts.onerror = finish;
      guard = window.setTimeout(finish, 15000);
      tts.src = tr.segueTtsUrl;
      tts.play().catch(finish);
    } else {
      startSong();
    }
  }, [reportState, t]);

  const startQueue = useCallback((q: Track[], startAt = 0) => {
    if (!q.length) return;
    const idx = Math.max(0, Math.min(startAt, q.length - 1));
    syncQueueState(q, idx);
    const tr = queueRef.current[idx];
    if (tr) playTrack(tr, idx);
    reportState();
  }, [syncQueueState, playTrack, reportState]);

  const playQueueIndex = useCallback((index: number, prunePlayed = false) => {
    if (!isController) return;
    const q = queueRef.current;
    if (index < 0 || index >= q.length) return;
    if (prunePlayed && index > 0) {
      const trimmed = q.slice(index);
      applyQueueEdit(trimmed, 0);
      playTrack(trimmed[0], 0);
      return;
    }
    playTrack(q[index], index);
  }, [applyQueueEdit, playTrack, isController]);

  const clearPendingIdleStart = () => {
    if (pendingIdleTimerRef.current) {
      window.clearTimeout(pendingIdleTimerRef.current);
      pendingIdleTimerRef.current = undefined;
    }
    pendingIdleStartRef.current = null;
  };

  const schedulePendingIdleStart = useCallback((q: Track[], idx: number) => {
    clearPendingIdleStart();
    pendingIdleStartRef.current = { q, idx };
    pendingIdleTimerRef.current = window.setTimeout(() => {
      pendingIdleTimerRef.current = undefined;
      const pending = pendingIdleStartRef.current;
      if (pending) {
        pendingIdleStartRef.current = null;
        startQueue(pending.q, pending.idx);
      }
    }, 10000);
  }, [startQueue]);

  const playTtsUrl = useCallback((url?: string | null, after?: () => void) => {
    if (!url || !ttsRef.current) {
      after?.();
      return;
    }
    const tts = ttsRef.current;
    const a = audioRef.current;
    const dimMusic = !!(a && !a.paused);
    if (dimMusic && a) a.volume = 0.12;
    let done = false;
    let guard: number | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (guard) window.clearTimeout(guard);
      if (a) a.volume = 1;
      tts.onended = null;
      tts.onerror = null;
      after?.();
    };
    guard = window.setTimeout(finish, 15000);
    tts.src = url;
    tts.onended = finish;
    tts.onerror = finish;
    tts.play().catch(finish);
  }, []);

  const stampReason = (tracks: Track[], reason?: string) => (
    reason ? tracks.map((tr) => ({ ...tr, reason: tr.reason || reason })) : tracks
  );

  const applyBroadcast = useCallback((b: Broadcast) => {
    if (b.ts && b.ts <= lastBroadcastTs.current) return;
    if (b.ts) lastBroadcastTs.current = b.ts;
    if (typeof b.revision === 'number') queueRevisionRef.current = b.revision;

    setConn('on');
    if (b.error) {
      setSay(b.say || t('sayError'));
      return;
    }
    const cleanSay = b.say ? cleanSayText(b.say) : '';
    if (cleanSay) {
      setSay(cleanSay);
      setMessages((m) => [...m, { role: 'dj', text: cleanSay }]);
    } else {
      // A response with no patter (silent music refill, or the brain declined to
      // talk) must still clear the transient "thinking/arranging" placeholder,
      // or the 口播 line gets stuck. Leave a real DJ line from a prior segment
      // untouched during background refills.
      setSay((prev) => (prev === t('sayThinking') || prev === t('sayArranging'))
        ? (b.queue?.length ? t('sayTapPlay') : t('sayReady'))
        : prev);
    }

    const shouldAutoPlay = autoPlayUserInitRef.current && isController;
    const playTts = (after?: () => void) => {
      if (!b.ttsUrl && b.say && after) {
        pendingIdleStartRef.current = null;
        after();
        return;
      }
      playTtsUrl(b.ttsUrl, after);
    };

    try {
    switch (b.mode) {
      case 'append': {
        if (b.queue?.length) {
          const incoming = stampReason(b.queue, b.reason);
          const merged = [...queueRef.current, ...incoming];
          const wasIdle = idxRef.current < 0;
          const startAt = merged.length - incoming.length;
          syncQueueState(merged, wasIdle ? startAt : idxRef.current);
          if (wasIdle && shouldAutoPlay) startQueue(merged, startAt);
          else reportState();
        }
        return;
      }
      case 'insert': {
        if (b.queue?.length) {
          const incoming = stampReason(b.queue, b.reason);
          const wasIdle = idxRef.current < 0;
          const q = [...queueRef.current];
          const at = b.placement === 'append' ? q.length : idxRef.current + 1;
          q.splice(at, 0, ...incoming);
          if (wasIdle) {
            const startAt = Math.max(0, Math.min(at, q.length - 1));
            syncQueueState(q, startAt);
            if (shouldAutoPlay) {
              if (b.ttsUrl) playTts(() => startQueue(q, startAt));
              else if (b.say) {
                schedulePendingIdleStart(q, startAt);
                playTts();
              } else startQueue(q, startAt);
            }
            reportState();
            return;
          }
          syncQueueState(q, idxRef.current);
          reportState();
        }
        playTts();
        return;
      }
      case 'steer': {
        const keep = idxRef.current + 1;
        const q = queueRef.current.slice(0, keep);
        syncQueueState(q, idxRef.current);
        reportState();
        playTts();
        return;
      }
      case 'chat':
        playTts();
        return;
      default: {
        const q = b.queue?.length ? stampReason(b.queue, b.reason) : null;
        if (q) {
          const wasIdle = idxRef.current < 0;
          syncQueueState(q, wasIdle ? 0 : idxRef.current);
          if (shouldAutoPlay) playTts(() => startQueue(q, wasIdle ? 0 : idxRef.current));
          else playTts();
        } else playTts();
      }
    }
    } finally {
      autoPlayUserInitRef.current = false;
    }
  }, [t, startQueue, syncQueueState, reportState, playTtsUrl, isController, schedulePendingIdleStart]);

  const applyBroadcastRef = useRef(applyBroadcast);
  applyBroadcastRef.current = applyBroadcast;

  const applyTtsPatch = useCallback((p: TtsPatch) => {
    if (!p.ttsUrl) return;

    if (p.mode === 'append' && p.track) {
      const idx = queueRef.current.findIndex((tr, i) => {
        if (i <= idxRef.current) return false;
        if (p.track?.source && p.track?.id) return tr.source === p.track.source && tr.id === p.track.id;
        return tr.title === p.track?.title && tr.artist === p.track?.artist;
      });
      if (idx >= 0) {
        const next = queueRef.current.map((tr, i) => (
          i === idx ? { ...tr, segueTtsUrl: p.ttsUrl } : tr
        ));
        syncQueueState(next, idxRef.current);
      }
      return;
    }

    if (p.ts && p.ts < lastBroadcastTs.current) return;
    if (p.ts && Date.now() - p.ts > 45000) return;
    playTtsUrl(p.ttsUrl, () => {
      clearPendingIdleStart();
      const pending = pendingIdleStartRef.current;
      if (pending) {
        pendingIdleStartRef.current = null;
        startQueue(pending.q, pending.idx);
      }
    });
  }, [playTtsUrl, syncQueueState, startQueue]);

  const applyTtsPatchRef = useRef(applyTtsPatch);
  applyTtsPatchRef.current = applyTtsPatch;

  const clearPlaybackRecovery = () => {
    if (playbackRecoveryTimer.current) {
      window.clearTimeout(playbackRecoveryTimer.current);
      playbackRecoveryTimer.current = undefined;
    }
    if (skipTimerRef.current) {
      window.clearTimeout(skipTimerRef.current);
      skipTimerRef.current = undefined;
    }
  };

  const emitPlaybackEvent = useCallback((event: 'started' | 'completed' | 'skipped' | 'replayed' | 'like' | 'dislike', track?: Track | null) => {
    const tr = track || queueRef.current[idxRef.current];
    if (!tr?.id) return;
    const a = audioRef.current;
    api.playbackEvent({
      event,
      track: { id: tr.id, title: tr.title, artist: tr.artist, source: tr.source },
      position_sec: a?.currentTime || 0,
      queue_index: idxRef.current,
    }).catch(() => {});
    if (event === 'like') {
      setLikedKey(`${tr.source}:${tr.id}`);
      setFeedbackHint(t('feedbackLike'));
      window.setTimeout(() => setFeedbackHint(''), 3000);
    }
    if (event === 'dislike') {
      setFeedbackHint(t('feedbackDislike'));
      window.setTimeout(() => setFeedbackHint(''), 3000);
    }
  }, [t]);

  const next = (opts?: { reason?: 'skip' | 'end' }) => {
    clearPlaybackRecovery();
    const q = queueRef.current;
    const reason = opts?.reason || 'skip';
    if (reason === 'skip' && idxRef.current >= 0 && idxRef.current < q.length) {
      emitPlaybackEvent('skipped', q[idxRef.current]);
    }
    if (reason === 'end' && idxRef.current >= 0 && idxRef.current < q.length) {
      emitPlaybackEvent('completed', q[idxRef.current]);
    }
    if (idxRef.current < q.length - 1) {
      const ni = idxRef.current + 1;
      playQueueIndex(ni, true);
    } else if (q.length > 0 && idxRef.current === q.length - 1) {
      reportState();
    }
  };

  const onAudioError = () => {
    clearPlaybackRecovery();
    setPlaying(false);
    const q = queueRef.current;
    const failedUrl = audioRef.current?.src || null;
    errorTrackUrlRef.current = failedUrl;
    if (idxRef.current >= 0 && idxRef.current < q.length - 1) {
      const ni = idxRef.current + 1;
      setSay(t('sayTrackFailNext'));
      skipTimerRef.current = window.setTimeout(() => {
        skipTimerRef.current = undefined;
        const cur = queueRef.current[idxRef.current];
        if (cur?.url && errorTrackUrlRef.current && cur.url !== errorTrackUrlRef.current) return;
        playQueueIndex(ni, true);
      }, 250);
      return;
    }
    setSay(t('sayTrackFail'));
    reportState();
    if (isController && idxRef.current >= 0 && idxRef.current >= q.length - 1) {
      window.setTimeout(() => reportState(), 500);
    }
  };

  const schedulePlaybackRecovery = () => {
    clearPlaybackRecovery();
    const expectedUrl = queueRef.current[idxRef.current]?.url || '';
    playbackRecoveryTimer.current = window.setTimeout(() => {
      const a = audioRef.current;
      if (!a || a.paused) return;
      if (a.src !== expectedUrl) return;
      if (a.readyState < 3) onAudioError();
    }, 10000);
  };

  const prev = () => {
    clearPlaybackRecovery();
    const q = queueRef.current;
    if (idxRef.current > 0) {
      emitPlaybackEvent('replayed', q[idxRef.current]);
      const pi = idxRef.current - 1;
      playQueueIndex(pi);
    }
  };

  const resumePlayback = () => {
    primeAudio();
    const a = audioRef.current!;
    const q = queueRef.current;
    if (idxRef.current < 0 && q.length) {
      playTrack(q[0], 0);
      return;
    }
    a.play().catch(() => {
      primeAudio();
      window.setTimeout(() => {
        a.play().catch(() => setSay(t('sayTapPlay')));
      }, 300);
    });
  };

  const toggle = () => {
    if (!isController) return;
    const a = audioRef.current!;
    if (idxRef.current < 0 && queueRef.current.length) {
      resumePlayback();
      return;
    }
    if (a.paused) resumePlayback();
    else a.pause();
  };

  useEffect(() => {
    let ws: WebSocket | undefined;
    let stop = false;

    const connect = async () => {
      try {
        const token = encodeURIComponent(await api.session());
        if (stop) return;
        ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/stream?token=' + token);
      } catch {
        setConn('');
        if (!stop) window.setTimeout(connect, 2000);
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        setConn('on');
        reconnectDelayRef.current = 1000;
        reportState();
      };
      ws.onclose = () => {
        wsRef.current = null;
        setConn('');
        api.resetSession();
        if (!stop) {
          const delay = reconnectDelayRef.current;
          reconnectDelayRef.current = Math.min(delay * 1.8 + Math.random() * 400, 30000);
          window.setTimeout(connect, delay);
        }
      };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'hello') {
            clientIdRef.current = m.clientId || '';
            setWsClientId(m.clientId || null);
            if (m.role === 'observer' || m.role === 'controller') setClientRole(m.role);
            const q: Track[] = Array.isArray(m.queue) ? m.queue : [];
            syncFromServer(q, m.queueRevision ?? queueRevisionRef.current);
            void reconcileQueue();
            reportState();
          }
          if (m.type === 'queue' && Array.isArray(m.queue)) {
            syncFromServer(m.queue, m.revision ?? queueRevisionRef.current);
          }
          if (m.type === 'broadcast') applyBroadcastRef.current(m);
          if (m.type === 'tts') applyTtsPatchRef.current(m);
          if (m.type === 'session') {
            if (!m.clientId || m.clientId === clientIdRef.current) {
              if (m.role === 'observer' || m.role === 'controller') {
                setClientRole(m.role);
                if (m.role === 'observer') {
                  audioRef.current?.pause();
                  setPlaying(false);
                  setSay(t('sayObserver'));
                }
              }
            }
          }
          if (m.type === 'profile') {
            window.dispatchEvent(new CustomEvent('aurio:profile-progress', { detail: m }));
          }
        } catch (err) {
          console.warn('[Aurio WS] bad message', err);
        }
      };
    };

    connect();
    return () => { stop = true; wsRef.current = null; ws?.close(); };
  }, [syncFromServer, reconcileQueue, reportState, t]);

  useEffect(() => {
    if (conn !== 'on') return;
    const timer = window.setInterval(() => reportState(), 30000);
    return () => window.clearInterval(timer);
  }, [conn, reportState]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const tr = current;
    if (!tr) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const artwork = tr.coverArt
      ? [{ src: tr.coverArt, sizes: '512x512', type: 'image/jpeg' as const }]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: tr.title,
      artist: tr.artist,
      album: tr.album || 'Aurio',
      artwork,
    });
    navigator.mediaSession.playbackState = playing || segueActive ? 'playing' : 'paused';
    navigator.mediaSession.setActionHandler('play', () => { if (isController) resumePlayback(); });
    navigator.mediaSession.setActionHandler('pause', () => { audioRef.current?.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { if (isController) prev(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { if (isController) next(); });
    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
    };
  }, [current, playing, segueActive, isController]);

  const refreshStatus = useCallback(async (announce = false) => {
    try {
      const s = await api.status();
      if (s?.config) {
        const sourceServices = Array.isArray(s.sourceModes)
          ? servicesFromModes(s.sourceModes)
          : {
              netease: !!s.config.netease,
              navidrome: !!s.config.navidrome,
              qqmusic: !!s.config.qqmusic,
            };
        setServices({ ...sourceServices, weather: !!s.config.weather });
      }
      if (typeof s?.queue === 'number') {
        setQueueTotal(s.queue);
        if (idxRef.current < 0) setQueueIndex(-1);
      }
      if (s?.musicSource === 'netease' || s?.musicSource === 'navidrome' || s?.musicSource === 'qqmusic' || s?.musicSource === 'combined') {
        setMusicSource(s.musicSource);
      }
      if (announce && idxRef.current < 0) {
        if (!s?.config?.navidrome && !s?.config?.netease && !s?.config?.qqmusic) {
          setSay(t('sayNoSource'));
        } else {
          setSay(t('sayReady'));
        }
      }
    } catch {
      if (announce) setSay(t('sayServerDown'));
      setConn('');
    }
  }, [t]);

  useEffect(() => {
    void refreshStatus(true);
    const onSettingsChanged = () => { void refreshStatus(false); };
    window.addEventListener('aurio:settings-changed', onSettingsChanged);
    return () => window.removeEventListener('aurio:settings-changed', onSettingsChanged);
  }, [refreshStatus]);

  useEffect(() => () => clearPlaybackRecovery(), []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => reportState(), 20000);
    return () => window.clearInterval(timer);
  }, [playing, reportState]);

  useEffect(() => {
    if (!playing || !isController) return;
    let lock: WakeLockSentinel | null = null;
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    }
    return () => { lock?.release().catch(() => {}); };
  }, [playing, isController]);

  useEffect(() => {
    api.planToday().then((r) => {
      if (r?.plan?.mood) setPlanNote(r.plan.mood + (r.plan.note ? ` · ${r.plan.note}` : ''));
    }).catch(() => {});
    api.taste().then((r) => {
      const parts: string[] = [];
      if (r?.liked?.length) parts.push(r.liked.slice(0, 2).map((x) => x.name).join('、'));
      if (r?.avoidArtists?.length) parts.push(`避开 ${r.avoidArtists.slice(0, 2).map((a) => a.artist).join('、')}`);
      if (parts.length) setTasteLine(parts.join(' · '));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.messages(120).then((r) => {
      if (Array.isArray(r.messages)) {
        setMessages(r.messages.map((m) => ({
          role: m.role === 'user' ? 'user' : 'dj',
          text: m.role === 'dj' ? cleanSayText(m.text) : m.text,
          ts: m.ts,
        })));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.settings().then((s) => {
      if (!s.onboarded) setOnboard(true);
    }).catch(() => {});
  }, []);

  const onTime = () => {
    const a = audioRef.current!;
    setCur(fmt(a.currentTime));
    setDur(fmt(a.duration));
    setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
    if (!scrobbled.current && a.currentTime > 20 && idxRef.current >= 0) {
      scrobbled.current = true;
      const tr = queueRef.current[idxRef.current];
      if (tr) api.played({
        id: tr.id,
        title: tr.title,
        artist: tr.artist,
        source: tr.source,
        position_sec: a.currentTime,
        queue_index: idxRef.current,
      });
    }
  };

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
  };

  const steer = async (text: string) => {
    if (!isController) return;
    primeAudio();
    autoPlayUserInitRef.current = true;
    setConn('busy');
    setSay(t('sayArranging'));
    try {
      const b = (await api.chat(text)) as Broadcast;
      applyBroadcast(b);
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
      autoPlayUserInitRef.current = false;
    }
  };

  const send = async (text: string) => {
    if (!isController) return;
    primeAudio();
    autoPlayUserInitRef.current = true;
    setMessages((m) => [...m, { role: 'user', text }]);
    setConn('busy');
    setSay(t('sayThinking'));
    try {
      const b = (await api.chat(text)) as Broadcast;
      applyBroadcast(b);
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
      autoPlayUserInitRef.current = false;
    }
  };

  const trig = async (kind: string) => {
    if (!isController) return;
    primeAudio();
    autoPlayUserInitRef.current = true;
    setConn('busy');
    setSay(t('sayArranging'));
    try {
      const b = (await api.trigger(kind)) as Broadcast;
      applyBroadcast(b);
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
      autoPlayUserInitRef.current = false;
    }
  };

  const cycleSource = async () => {
    const next = nextMusicSource(musicSource, services);
    setMusicSource(next);
    try {
      const r = await postMusicSource(next);
      if (r.musicSource) setMusicSource(r.musicSource);
    } catch {
      api.status().then((s) => {
        if (s?.musicSource) setMusicSource(s.musicSource);
      }).catch(() => {});
    }
  };

  const petState: PetState = conn === 'busy' ? 'talking' : (playing || segueActive) ? 'playing' : 'idle';
  const controlsDisabled = !isController || conn === 'busy';
  const connLabel = conn === 'on' ? t('connOn') : conn === 'busy' ? t('connBusy') : t('connOff');
  const headerSub = playing && current
    ? current.title
    : conn === 'busy'
      ? t('statusArranging')
      : connLabel;

  return (
    <>
    <WidgetShell>
      <motion.header {...stagger(0)} className="app-header shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className={`header-avatar ${petState !== 'idle' ? 'is-live' : ''}`} aria-hidden>
            <PixelPet state={petState} cell={4} />
          </div>
          <div className="min-w-0">
            <p className="font-matrix text-[16px] text-[var(--matrix-fg)] leading-none tracking-[0.02em] lowercase">aurio</p>
            <p className="text-[10px] text-[var(--text-muted)] font-mono mt-1 truncate max-w-[180px]" title={headerSub}>
              {headerSub}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className={`header-pill ${resolved === 'dark' ? 'is-active' : ''}`}
            onClick={() => setTheme('dark')}
          >
            {t('pillDark')}
          </button>
          <button
            type="button"
            className={`header-pill ${resolved === 'light' ? 'is-active' : ''}`}
            onClick={() => setTheme('light')}
          >
            {t('pillLight')}
          </button>
          <PressButton variant="icon" ariaLabel={t('ariaChat')} onClick={() => setChatOpen((o) => !o)} className="!w-8 !h-8 !rounded-full">
            <IconChat size={15} />
          </PressButton>
          <PressButton variant="icon" ariaLabel={t('ariaSettings')} onClick={() => { setSettingsGroup(undefined); setSettingsOpen(true); }} className="!w-8 !h-8 !rounded-full">
            <IconSettings size={15} />
          </PressButton>
        </div>
      </motion.header>

      <motion.div {...stagger(1)} className="shrink-0">
        <StatusStrip
          conn={conn}
          playing={playing}
          hasTrack={!!current}
          services={services}
          musicSource={musicSource}
          queueTotal={queueTotal}
          queueRemaining={queueRemaining}
          onCycleSource={cycleSource}
        />
      </motion.div>

      <motion.div {...stagger(2)} className="min-h-0 flex-1 overflow-hidden">
        <MainCard
          track={current}
          progress={progress}
          cur={cur}
          dur={dur}
          say={say}
          now={now}
          playing={playing}
          conn={conn}
          onSeek={onSeek}
          audioRef={audioRef}
          services={services}
          queue={queue}
          queueIndex={queueIndex}
          onPick={(i) => playQueueIndex(i, true)}
          onReorder={reorderUpNext}
          onRemove={removeAt}
          onClear={clearUpNext}
          onSteer={steer}
          onTrigger={trig}
          isObserver={!isController}
          controlsDisabled={controlsDisabled}
          tasteLine={tasteLine}
          planNote={planNote}
        />
      </motion.div>

      {feedbackHint && (
        <motion.p {...stagger(2)} className="text-center text-[11px] text-[rgb(var(--hi-rgb))] font-mono shrink-0">
          {feedbackHint}
        </motion.p>
      )}

      <motion.div {...stagger(3)} className="transport-row shrink-0">
        <AnimatePresence>
          {playing && (
            <motion.span
              className="transport-ring"
              initial={{ scale: 0.85, opacity: 0.5 }}
              animate={{ scale: [1, 1.28, 1], opacity: [0.4, 0, 0.4] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
        </AnimatePresence>

        <PressButton variant="ghost" ariaLabel={t('ariaPrev')} onClick={prev} disabled={controlsDisabled || queueIndex <= 0}>
          <IconPrev size={17} />
        </PressButton>
        <PressButton variant="ghost" ariaLabel={t('ariaLike')} onClick={() => emitPlaybackEvent('like', current)} disabled={controlsDisabled || !current}>
          <span className={`text-sm ${likedKey && current && likedKey === `${current.source}:${current.id}` ? 'text-[rgb(var(--hi-rgb))]' : ''}`}>♥</span>
        </PressButton>
        <PressButton
          variant="play"
          ariaLabel={playing ? t('ariaPause') : t('ariaPlay')}
          onClick={toggle}
          className={playing ? 'is-playing' : ''}
          disabled={controlsDisabled && !isController}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={playing ? 'pause' : 'play'}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={spring.snappy}
            >
              {playing ? <IconPause size={22} /> : <IconPlay size={22} className="ml-0.5" />}
            </motion.span>
          </AnimatePresence>
        </PressButton>
        <PressButton variant="ghost" ariaLabel={t('ariaDislike')} onClick={() => {
          emitPlaybackEvent('dislike', current);
          clearPlaybackRecovery();
          const q = queueRef.current;
          if (idxRef.current < q.length - 1) playQueueIndex(idxRef.current + 1, true);
          else reportState();
        }} disabled={controlsDisabled || !current}>
          <span className="text-sm">👎</span>
        </PressButton>
        <PressButton variant="ghost" ariaLabel={t('ariaNext')} onClick={next} disabled={controlsDisabled || queueIndex < 0}>
          <IconNext size={17} />
        </PressButton>
      </motion.div>

      <motion.div {...stagger(4)} className="shrink-0">
        <PressButton variant="bar" onClick={() => setChatOpen(true)} ariaLabel={t('ariaOpenChat')}>
          <span className="text-[var(--text-muted)] text-[13px] flex-1 text-left truncate">{t('chatBarHint')}</span>
          <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-[0.2em] shrink-0">{t('chatBarLabel')}</span>
        </PressButton>
      </motion.div>

      <audio
        ref={audioRef}
        onTimeUpdate={onTime}
        onEnded={() => next({ reason: 'end' })}
        onError={onAudioError}
        onWaiting={schedulePlaybackRecovery}
        onStalled={schedulePlaybackRecovery}
        onCanPlay={clearPlaybackRecovery}
        onPlaying={clearPlaybackRecovery}
        onPlay={() => { clearPlaybackRecovery(); setPlaying(true); reportState(); }}
        onPause={() => {
          clearPlaybackRecovery();
          if (!segueActiveRef.current) setPlaying(false);
          reportState();
        }}
      />
      <audio ref={ttsRef} />
    </WidgetShell>

    <ChatSheet open={chatOpen} onClose={() => setChatOpen(false)} messages={messages} onSend={send} onTrigger={trig} busy={conn === 'busy'} onGoAir={() => trig('station')} isObserver={!isController} />
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} currentTrack={current} initialGroup={settingsGroup} />
    <Onboarding
      open={onboard}
      onOpenGroup={(g) => { setSettingsGroup(g); setSettingsOpen(true); }}
      onFinish={async () => {
        try { await api.saveSettings({ ONBOARDED: '1' }); } catch { /* ignore */ }
        setOnboard(false);
        if (isController) {
          autoPlayUserInitRef.current = true;
          void trig('station');
        }
      }}
    />
    </>
  );
}
