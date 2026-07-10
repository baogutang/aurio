import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MainCard from './components/MainCard';
import ChatSheet from './components/ChatSheet';
import SettingsModal from './components/SettingsModal';
import Onboarding, { type OnboardGroup } from './components/Onboarding';
import WidgetShell from './components/WidgetShell';
import StatusStrip from './components/StatusStrip';
import PressButton from './components/PressButton';
import PixelPet, { type PetState } from './components/PixelPet';
import HeaderWeather from './components/HeaderWeather';
import { IconChat, IconSettings, IconPrev, IconNext, IconPlay, IconPause, IconHeart, IconDislike } from './components/icons';
import { api, fmt, setWsClientId } from './lib/api';
import { mergeQueueWhilePlaying } from './lib/queueSync';
import { formatNow, type NowDisplay } from './lib/dateFormat';
import { nextMusicSource, postMusicSource, servicesFromModes, type MusicSourceMode, type MusicServices } from './lib/musicSource';
import { spring, stagger } from './lib/motion';
import { cleanSayText } from './lib/highlight';
import { isHotlineAccepted, shouldAutoCloseChat } from './lib/chatFlow';
import { dedupeQueue } from './lib/queue';
import { coverUrl } from './lib/cover';
import {
  initMixer, resumeMixer, duckMusic, unduckMusic, getMixer,
  setMusicChannelGain, crossfadeMusic, fadeOutMusic, playRetuneSound, type MusicChannel,
} from './lib/audioGraph';
import { tuneStation, type StationMood } from './lib/station';
import { useI18n, usePreferences } from './context/PreferencesContext';
import type { Track, Broadcast, ChatMsg, TtsPatch } from './lib/types';

// Gapless handoff tuning: prefetch the next track into the standby element
// once the current one has this many seconds left, then run an equal-power
// crossfade of roughly this length right before the natural end. A manual
// skip only gets a quick fade-out so it still feels immediate.
const PREFETCH_WINDOW_SEC = 20;
const AUTO_CROSSFADE_SEC = 2;
const MANUAL_FADE_SEC = 0.25;

// After a successful chat reply the sheet lingers this long — enough to see
// the answer land — then closes itself back to the main card (user feedback
// 2026-07-10: 「跟Aurio对话后，聊天框应该随着处理完自动关闭显示主界面」).
const CHAT_AUTOCLOSE_MS = 1000;

const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export default function App() {
  const { t, localeTag, locale } = useI18n();
  const { resolved, setTheme, reducedMotion } = usePreferences();
  // audioRef is the stable accessor for THE ACTIVE music element. Two music
  // elements (A/B) alternate underneath so the next track can be prefetched
  // and crossfaded in; everything that asks "what is playing" (heartbeat,
  // MediaSession, tray, seek, the pause/resume src guard) reads
  // audioRef.current and keeps working unchanged.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicElsRef = useRef<(HTMLAudioElement | null)[]>([null, null]);
  const activeChRef = useRef<MusicChannel>(0);
  const prefetchRef = useRef<{ url: string } | null>(null);
  const pendingRetireRef = useRef<{ ch: MusicChannel; timer: number } | null>(null);
  const playTokenRef = useRef(0);
  const autoFadeFiredRef = useRef(-1);
  const cancelSegueRef = useRef<(() => void) | null>(null);
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
  const consumedSegueRef = useRef<Set<string>>(new Set());

  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [segueActive, setSegueActive] = useState(false);
  const [talking, setTalking] = useState(false);
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
  // Hotline state line (点歌已记下) under the latest chat reply — set when the
  // DJ accepts a non-urgent song request for later, cleared on close/next send.
  const [hotlineNotice, setHotlineNotice] = useState(false);
  // Chat auto-close bookkeeping: input-activity counter (focus/typing since a
  // send cancels the close), in-flight send count, and the linger timer.
  const chatActivityRef = useRef(0);
  const chatSendsRef = useRef(0);
  const chatCloseTimerRef = useRef<number | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsGroup, setSettingsGroup] = useState<OnboardGroup | undefined>(undefined);
  const [onboard, setOnboard] = useState(false);
  const [services, setServices] = useState<MusicServices & { weather: boolean }>({ netease: false, navidrome: false, qqmusic: false, weather: false });
  const [musicSource, setMusicSource] = useState<MusicSourceMode>('combined');
  const [steerMood, setSteerMood] = useState<StationMood | null>(null);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [queue, setQueue] = useState<Track[]>([]);
  // 0..1 fraction of the say text revealed while the DJ voice plays (null = whole).
  const [sayReveal, setSayReveal] = useState<number | null>(null);
  const revealRafRef = useRef(0);
  const revealValRef = useRef<number | null>(null);
  // Bumped whenever audioRef.current points at a different element.
  const [activeElVer, setActiveElVer] = useState(0);

  const isController = clientRole === 'controller';

  // MainCard's children (Spectrum / Lyrics) capture audioRef.current inside
  // their effects, so hand them a snapshot ref whose identity changes whenever
  // the active element flips — the effects re-run and re-capture the right one.
  const mainCardAudioRef = useMemo<React.RefObject<HTMLAudioElement>>(
    () => ({ current: audioRef.current }),
    [activeElVer], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const bindMusicEl = useCallback((ch: MusicChannel, el: HTMLAudioElement | null) => {
    const prevEl = musicElsRef.current[ch];
    musicElsRef.current[ch] = el;
    if (el) {
      if (!audioRef.current) {
        audioRef.current = el;
        activeChRef.current = ch;
        setActiveElVer((v) => v + 1);
      }
    } else if (prevEl && audioRef.current === prevEl) {
      audioRef.current = null;
    }
  }, []);
  const bindMusicA = useCallback((el: HTMLAudioElement | null) => { bindMusicEl(0, el); }, [bindMusicEl]);
  const bindMusicB = useCallback((el: HTMLAudioElement | null) => { bindMusicEl(1, el); }, [bindMusicEl]);

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
      const audio = audioRef.current;
      ws.send(JSON.stringify({
        type: 'state',
        playingIndex: idxRef.current,
        paused: audio?.paused ?? true,
        queueLen: queueRef.current.length,
        queueRevision: queueRevisionRef.current,
        currentTrack: tr ? { id: tr.id, title: tr.title, artist: tr.artist, source: tr.source } : null,
        positionSec: audio?.currentTime ?? 0,
        durationSec: audio && !Number.isNaN(audio.duration) ? audio.duration : 0,
      }));
    }
  }, []);

  // Duck / unduck the music bed under the DJ voice. Uses the scheduled gain
  // ramp when the mixer exists, and falls back to the old el.volume step when
  // Web Audio is unavailable.
  const duck = useCallback((music: HTMLAudioElement | null) => {
    if (getMixer()) duckMusic();
    else if (music) music.volume = 0.12;
  }, []);
  const unduck = useCallback((music: HTMLAudioElement | null) => {
    if (getMixer()) unduckMusic();
    else if (music) music.volume = 1;
  }, []);

  // --- Voice conductor: the say text reveals per code point, paced by the TTS
  // audio clock (fraction = currentTime / duration once loadedmetadata gives a
  // duration; CJK ≈ one syllable per character, so proportional allocation is
  // accurate enough). Any interruption — skip cancels the segue, pause, error —
  // rolls back to the whole sentence at once. A say without TTS audio never
  // enters here and shows whole, as before.
  const stopSayReveal = useCallback(() => {
    if (revealRafRef.current) {
      cancelAnimationFrame(revealRafRef.current);
      revealRafRef.current = 0;
    }
    revealValRef.current = null;
    setSayReveal(null);
  }, []);

  const startSayReveal = useCallback((tts: HTMLAudioElement) => {
    if (revealRafRef.current) cancelAnimationFrame(revealRafRef.current);
    if (reducedMotion) {
      // Whole-sentence subtitles under reduced motion.
      revealValRef.current = null;
      setSayReveal(null);
      revealRafRef.current = 0;
      return;
    }
    revealValRef.current = 0;
    setSayReveal(0);
    const tick = () => {
      const d = tts.duration;
      if (Number.isFinite(d) && d > 0) {
        const f = Math.min(1, tts.currentTime / d);
        if (f >= 1) {
          stopSayReveal();
          return;
        }
        // Quantize to ~1% steps so the reveal does not re-render at 60fps.
        const q = Math.floor(f * 100) / 100;
        if (q !== revealValRef.current) {
          revealValRef.current = q;
          setSayReveal(q);
        }
      }
      revealRafRef.current = requestAnimationFrame(tick);
    };
    revealRafRef.current = requestAnimationFrame(tick);
  }, [reducedMotion, stopSayReveal]);

  useEffect(() => () => {
    if (revealRafRef.current) cancelAnimationFrame(revealRafRef.current);
  }, []);

  const primeAudio = useCallback(() => {
    resumeMixer();
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
    Promise.all([
      prime(musicElsRef.current[0]),
      prime(musicElsRef.current[1]),
      prime(ttsRef.current),
    ]).then(() => {
      audioPrimed.current = true;
    });
  }, []);

  useEffect(() => {
    const a = musicElsRef.current[0];
    const b = musicElsRef.current[1];
    const voice = ttsRef.current;
    if (a && b && voice) initMixer(a, b, voice);
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

  // Retire a music channel that has finished fading out: silence it, drop its
  // src and leave it as the standby element for the next prefetch. Never
  // touches the active element.
  const retireChannel = useCallback((ch: MusicChannel) => {
    const el = musicElsRef.current[ch];
    if (!el || el === audioRef.current) return;
    try { el.pause(); } catch { /* noop */ }
    el.removeAttribute('src');
    try { el.load(); } catch { /* noop */ }
    setMusicChannelGain(ch, 0);
  }, []);

  const finalizePendingRetire = useCallback(() => {
    const pending = pendingRetireRef.current;
    if (!pending) return;
    pendingRetireRef.current = null;
    window.clearTimeout(pending.timer);
    retireChannel(pending.ch);
  }, [retireChannel]);

  const playTrack = useCallback((tr: Track, idx: number, opts?: { transition?: 'auto' | 'manual' }) => {
    if (!tr?.url) {
      setPlaying(false);
      setSay(t('sayTrackFail'));
      return;
    }
    clearPlaybackRecovery();
    cancelSegueRef.current?.();
    scrobbled.current = false;
    playTokenRef.current += 1;
    setCurrent(tr);
    setQueueIndex(idx);
    idxRef.current = idx;
    if (tr.segue) setSay(tr.segue);

    const transition = opts?.transition ?? 'manual';
    const segueKey = tr.uid ?? `${tr.source}:${tr.id}`;
    const wantSegue = !!(tr.segueTtsUrl && ttsRef.current && !consumedSegueRef.current.has(segueKey));

    if (!getMixer()) {
      // Fallback: mixer failed to init (autoplay/CSP edge) — keep today's
      // single-element hard cut. audioRef never flips in this mode.
      const a = audioRef.current;
      if (!a) return;
      const startSong = () => {
        segueActiveRef.current = false;
        setSegueActive(false);
        a.src = tr.url!;
        resumeMixer();
        unduck(a);
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
      if (wantSegue) {
        consumedSegueRef.current.add(segueKey);
        const tts = ttsRef.current!;
        const dimMusic = !!(a.src && !a.paused);
        segueActiveRef.current = true;
        setSegueActive(true);
        if (dimMusic) duck(a);
        let done = false;
        let guard: number | undefined;
        const finish = () => {
          if (done) return;
          done = true;
          if (guard) window.clearTimeout(guard);
          tts.onended = null;
          tts.onerror = null;
          stopSayReveal();
          startSong();
        };
        tts.onended = finish;
        tts.onerror = finish;
        guard = window.setTimeout(finish, 15000);
        tts.src = tr.segueTtsUrl!;
        tts.play().catch(finish);
        if (tr.segue) startSayReveal(tts);
      } else {
        startSong();
      }
      return;
    }

    // Mixer path: the incoming track starts on the standby element and the two
    // channel gains carry the transition — an equal-power crossfade on a
    // natural end, a quick fade-out on a manual skip. Never a hard `src` cut.
    const startCrossfaded = (underVoice: boolean) => {
      const outCh = activeChRef.current;
      const inCh: MusicChannel = outCh === 0 ? 1 : 0;
      finalizePendingRetire(); // frees the incoming element if a fade-out is still parked on it
      const outgoing = musicElsRef.current[outCh];
      const incoming = musicElsRef.current[inCh];
      if (!incoming) return;

      const prefetched = prefetchRef.current?.url === tr.url;
      prefetchRef.current = null;
      if (!prefetched) {
        incoming.preload = 'auto';
        incoming.src = tr.url!;
      }

      const outLive = !!(outgoing && outgoing.getAttribute('src') && !outgoing.paused && !outgoing.ended);

      activeChRef.current = inCh;
      audioRef.current = incoming;
      setActiveElVer((v) => v + 1);

      if (!underVoice) {
        segueActiveRef.current = false;
        setSegueActive(false);
      }

      resumeMixer();
      if (!underVoice) unduck(incoming);

      if (outLive && outgoing) {
        if (transition === 'auto') {
          crossfadeMusic(outCh, inCh, AUTO_CROSSFADE_SEC);
        } else {
          setMusicChannelGain(inCh, 1);
          fadeOutMusic(outCh, MANUAL_FADE_SEC);
        }
        const fade = transition === 'auto' ? AUTO_CROSSFADE_SEC : MANUAL_FADE_SEC;
        pendingRetireRef.current = {
          ch: outCh,
          timer: window.setTimeout(() => {
            pendingRetireRef.current = null;
            retireChannel(outCh);
          }, fade * 1000 + 150),
        };
      } else {
        setMusicChannelGain(inCh, 1);
        retireChannel(outCh);
      }

      api.playbackEvent({
        event: 'started',
        track: { id: tr.id, title: tr.title, artist: tr.artist, source: tr.source },
        queue_index: idx,
      }).catch(() => {});
      incoming.play()
        .then(() => reportState())
        .catch(() => {
          setPlaying(false);
          if (autoPlayUserInitRef.current) setSay(t('sayTapPlay'));
          reportState();
        });
    };

    if (wantSegue) {
      // The crossfade IS the bed under her voice: the A→B transition runs
      // while she talks and the duck on the shared music bus keeps it low, so
      // she is never speaking into silence.
      consumedSegueRef.current.add(segueKey);
      const tts = ttsRef.current!;
      segueActiveRef.current = true;
      setSegueActive(true);
      duck(audioRef.current);
      let done = false;
      let guard: number | undefined;
      const settle = (stopVoice: boolean) => {
        if (done) return;
        done = true;
        if (guard) window.clearTimeout(guard);
        tts.onended = null;
        tts.onerror = null;
        if (stopVoice) { try { tts.pause(); } catch { /* noop */ } }
        if (cancelSegueRef.current === cancel) cancelSegueRef.current = null;
        segueActiveRef.current = false;
        setSegueActive(false);
        stopSayReveal();
        unduck(audioRef.current);
      };
      const finish = () => settle(false);
      const cancel = () => settle(true);
      cancelSegueRef.current = cancel;
      tts.onended = finish;
      tts.onerror = finish;
      guard = window.setTimeout(finish, 15000);
      resumeMixer();
      tts.src = tr.segueTtsUrl!;
      tts.play().catch(finish);
      if (tr.segue) startSayReveal(tts);
      startCrossfaded(true);
    } else {
      startCrossfaded(false);
    }
  }, [reportState, t, duck, unduck, retireChannel, finalizePendingRetire, startSayReveal, stopSayReveal]);

  const startQueue = useCallback((q: Track[], startAt = 0) => {
    if (!q.length) return;
    const idx = Math.max(0, Math.min(startAt, q.length - 1));
    syncQueueState(q, idx);
    const tr = queueRef.current[idx];
    if (tr) playTrack(tr, idx);
    reportState();
  }, [syncQueueState, playTrack, reportState]);

  const playQueueIndex = useCallback((index: number, prunePlayed = false, transition: 'auto' | 'manual' = 'manual') => {
    if (!isController) return;
    const q = queueRef.current;
    if (index < 0 || index >= q.length) return;
    if (prunePlayed && index > 0) {
      const trimmed = q.slice(index);
      applyQueueEdit(trimmed, 0);
      playTrack(trimmed[0], 0, { transition });
      return;
    }
    playTrack(q[index], index, { transition });
  }, [applyQueueEdit, playTrack, isController]);

  const playTtsUrl = useCallback((url?: string | null, after?: () => void, opts?: { reveal?: boolean }) => {
    if (!url || !ttsRef.current) {
      after?.();
      return;
    }
    const tts = ttsRef.current;
    const a = audioRef.current;
    const dimMusic = !!(a && !a.paused);
    if (dimMusic) duck(a);
    let done = false;
    let guard: number | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (guard) window.clearTimeout(guard);
      unduck(a);
      tts.onended = null;
      tts.onerror = null;
      stopSayReveal();
      after?.();
    };
    guard = window.setTimeout(finish, 15000);
    resumeMixer();
    tts.src = url;
    tts.onended = finish;
    tts.onerror = finish;
    tts.play().catch(finish);
    if (opts?.reveal) startSayReveal(tts);
  }, [duck, unduck, startSayReveal, stopSayReveal]);

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
    }

    const shouldAutoPlay = autoPlayUserInitRef.current && isController;
    const playTts = (after?: () => void) => {
      if (!b.ttsUrl && b.say && after) {
        after();
        return;
      }
      // Only pace the subtitle when this voice actually voices a fresh say.
      playTtsUrl(b.ttsUrl, after, { reveal: !!cleanSay });
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
              playTts(() => startQueue(q, startAt));
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
        if (Array.isArray(b.queue) && b.queue.length && typeof b.revision === 'number') {
          syncFromServer(stampReason(b.queue, b.reason), b.revision, idxRef.current);
        } else {
          const keep = idxRef.current + 1;
          syncQueueState(queueRef.current.slice(0, keep), idxRef.current);
        }
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
  }, [t, startQueue, syncQueueState, reportState, playTtsUrl, isController]);

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
    playTtsUrl(p.ttsUrl);
  }, [playTtsUrl, syncQueueState]);

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

  const refreshTaste = useCallback(() => {
    api.taste().then((r) => {
      const parts: string[] = [];
      if (r?.liked?.length) parts.push(r.liked.slice(0, 2).map((x) => x.name).join('、'));
      if (r?.avoidArtists?.length) parts.push(`避开 ${r.avoidArtists.slice(0, 2).map((a) => a.artist).join('、')}`);
      setTasteLine(parts.length ? parts.join(' · ') : '');
    }).catch(() => {});
  }, []);

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
      refreshTaste();
    }
    if (event === 'dislike') {
      setFeedbackHint(t('feedbackDislike'));
      window.setTimeout(() => setFeedbackHint(''), 3000);
      refreshTaste();
    }
  }, [t, refreshTaste]);

  const next = (opts?: { reason?: 'skip' | 'end'; transition?: 'auto' | 'manual' }) => {
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
      playQueueIndex(ni, true, opts?.transition ?? 'manual');
    } else if (q.length > 0 && idxRef.current === q.length - 1) {
      reportState();
    }
  };

  const onAudioError = (el: HTMLAudioElement) => {
    if (el !== audioRef.current) {
      // The standby prefetch failed — forget it. End-of-track then falls back
      // to the ordinary advance path instead of a crossfade.
      prefetchRef.current = null;
      return;
    }
    clearPlaybackRecovery();
    setPlaying(false);
    const q = queueRef.current;
    const failedUrl = el.src || null;
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
      if (a.readyState < 3) onAudioError(a);
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
    const q = queueRef.current;
    const idx = idxRef.current >= 0 ? idxRef.current : 0;
    const a = audioRef.current!;
    // Resume the already-loaded track in place. Re-running playTrack would reset
    // the media element (currentTime -> 0) and could replay the segue.
    if (idxRef.current >= 0 && q[idx]?.url && a.src === q[idx].url && !a.ended) {
      a.play().catch(() => setSay(t('sayTapPlay')));
      return;
    }
    if (q.length) {
      playTrack(q[idx], idx);
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
    if ((idxRef.current < 0 || !current) && queueRef.current.length) {
      resumePlayback();
      return;
    }
    if (a.paused) resumePlayback();
    else a.pause();
  };

  // Transport handlers are re-created every render; keep them in refs so the
  // stable media-key effect always calls the current closure.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const nextRef = useRef(next);
  nextRef.current = next;
  const prevRef = useRef(prev);
  prevRef.current = prev;

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
    const timer = window.setInterval(() => reportState(), 8000);
    return () => window.clearInterval(timer);
  }, [conn, reportState]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const tr = current;
    if (!tr) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const cover = coverUrl(tr);
    const artwork = cover
      ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' as const }]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: tr.title,
      artist: tr.artist,
      album: tr.album || 'Aurio',
      artwork,
    });
    navigator.mediaSession.playbackState = playing || segueActive ? 'playing' : 'paused';
    navigator.mediaSession.setActionHandler('play', () => { if (isController) resumePlayback(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (isController) audioRef.current?.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { if (isController) prev(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { if (isController) next(); });
    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
    };
  }, [current, playing, segueActive, isController]);

  useEffect(() => {
    const aurio = (window as Window & { aurio?: { tray?: { setOnAir?: (on: boolean) => void } } }).aurio;
    aurio?.tray?.setOnAir?.(playing || segueActive);
  }, [playing, segueActive]);

  useEffect(() => {
    const media = (window as Window & {
      aurio?: { media?: { onCommand?: (h: (cmd: 'playpause' | 'next' | 'prev' | 'stop') => void) => (() => void) } };
    }).aurio?.media;
    if (!media?.onCommand) return;
    const unsub = media.onCommand((cmd) => {
      if (!isController) return;
      if (cmd === 'playpause') toggleRef.current();
      else if (cmd === 'next') nextRef.current();
      else if (cmd === 'prev') prevRef.current();
      else if (cmd === 'stop') audioRef.current?.pause();
    });
    return () => { unsub?.(); };
  }, [isController]);

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

  const onTime = (a: HTMLAudioElement) => {
    if (a !== audioRef.current) return;
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

    // Gapless handoff: inside the last PREFETCH_WINDOW_SEC load the next
    // queued track into the standby element, re-aiming it whenever the queue
    // changes; then hand off with an equal-power crossfade just before the
    // current track runs out. Without the mixer this stays inert and the
    // single-element hard cut applies.
    if (!getMixer() || !isController || a.paused) return;
    const total = a.duration;
    if (!Number.isFinite(total) || total <= 0) return;
    const standby = musicElsRef.current[activeChRef.current === 0 ? 1 : 0];
    if (!standby) return;
    // The previous track's tail is still fading on the standby element; it
    // clears within a couple of seconds, and only jingle-length tracks would
    // even want a prefetch this early.
    if (pendingRetireRef.current) return;
    const remaining = total - a.currentTime;
    const nextTr = queueRef.current[idxRef.current + 1];

    if (remaining <= PREFETCH_WINDOW_SEC) {
      if (nextTr?.url) {
        if (prefetchRef.current?.url !== nextTr.url) {
          prefetchRef.current = { url: nextTr.url };
          standby.preload = 'auto';
          standby.src = nextTr.url;
        }
      } else if (prefetchRef.current) {
        // The queue changed under us and there is no next track anymore.
        prefetchRef.current = null;
        standby.removeAttribute('src');
        try { standby.load(); } catch { /* noop */ }
      }
    }

    if (
      remaining > 0 &&
      remaining <= AUTO_CROSSFADE_SEC + 0.35 &&
      nextTr?.url &&
      prefetchRef.current?.url === nextTr.url &&
      standby.readyState >= 3 &&
      autoFadeFiredRef.current !== playTokenRef.current
    ) {
      autoFadeFiredRef.current = playTokenRef.current;
      next({ reason: 'end', transition: 'auto' });
    }
  };

  // Both music elements share these handlers; only the active element drives
  // app state, so the outgoing element of a crossfade (its late pause/ended
  // events) and the standby prefetch never disturb playback state.
  const onMusicEnded = (el: HTMLAudioElement) => {
    if (el !== audioRef.current) return;
    next({ reason: 'end' });
  };
  const onMusicWaiting = (el: HTMLAudioElement) => {
    if (el !== audioRef.current) return;
    schedulePlaybackRecovery();
  };
  const onMusicSettled = (el: HTMLAudioElement) => {
    if (el !== audioRef.current) return;
    clearPlaybackRecovery();
  };
  const onMusicPlay = (el: HTMLAudioElement) => {
    if (el !== audioRef.current) return;
    clearPlaybackRecovery();
    setPlaying(true);
    reportState();
  };
  const onMusicPause = (el: HTMLAudioElement) => {
    if (el !== audioRef.current) return;
    clearPlaybackRecovery();
    // Pausing mid-crossfade must silence the outgoing tail too.
    finalizePendingRetire();
    if (!segueActiveRef.current) setPlaying(false);
    reportState();
  };

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
  };

  // Steering the programming is turning the dial: nudge the pseudo-FM
  // frequency and play the retune burst. Only user-initiated switches sound —
  // this runs from chip clicks, never on mount or on server pushes.
  const steer = async (text: string, mood?: StationMood) => {
    if (!isController) return;
    primeAudio();
    if (mood) {
      setSteerMood(mood);
      playRetuneSound();
    }
    autoPlayUserInitRef.current = true;
    setConn('busy');
    try {
      const b = (await api.chat(text)) as Broadcast;
      applyBroadcast(b);
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
      autoPlayUserInitRef.current = false;
    }
  };

  // --- Chat sheet auto-close --------------------------------------------
  // After a successful reply the sheet lingers CHAT_AUTOCLOSE_MS so the answer
  // is seen in-sheet, then closes back to the main card (the DJ's say already
  // lands there). Never when the request errored, when the user focused/typed
  // in the input since sending, or while another send is still in flight —
  // the guard (lib/chatFlow.ts) is checked when the reply lands AND again when
  // the timer fires, so re-engaging during the linger also keeps it open.
  const cancelChatAutoClose = useCallback(() => {
    if (chatCloseTimerRef.current !== undefined) {
      window.clearTimeout(chatCloseTimerRef.current);
      chatCloseTimerRef.current = undefined;
    }
  }, []);

  const scheduleChatAutoClose = useCallback((activityAtSend: number) => {
    const clear = () => shouldAutoCloseChat({
      sendsInFlight: chatSendsRef.current,
      activityAtSend,
      activityNow: chatActivityRef.current,
    });
    if (!clear()) return;
    cancelChatAutoClose();
    chatCloseTimerRef.current = window.setTimeout(() => {
      chatCloseTimerRef.current = undefined;
      if (clear()) setChatOpen(false);
    }, CHAT_AUTOCLOSE_MS);
  }, [cancelChatAutoClose]);

  // Any close path — manual, backdrop, Escape, or the auto-close itself —
  // clears the pending timer and the hotline notice; unmount clears the timer.
  useEffect(() => {
    if (!chatOpen) {
      cancelChatAutoClose();
      setHotlineNotice(false);
    }
  }, [chatOpen, cancelChatAutoClose]);
  useEffect(() => cancelChatAutoClose, [cancelChatAutoClose]);

  const send = async (text: string) => {
    if (!isController) return;
    primeAudio();
    autoPlayUserInitRef.current = true;
    setMessages((m) => [...m, { role: 'user', text }]);
    setHotlineNotice(false);
    cancelChatAutoClose();
    const activityAtSend = chatActivityRef.current;
    chatSendsRef.current += 1;
    setConn('busy');
    let replied = false;
    try {
      const b = (await api.chat(text)) as Broadcast;
      applyBroadcast(b);
      // 热线接受确认: the DJ queued the request for later — show the state line.
      if (isHotlineAccepted(b)) setHotlineNotice(true);
      replied = !b.error;
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
      autoPlayUserInitRef.current = false;
    } finally {
      chatSendsRef.current -= 1;
    }
    if (replied) scheduleChatAutoClose(activityAtSend);
  };

  const trig = async (kind: string) => {
    if (!isController) return;
    primeAudio();
    autoPlayUserInitRef.current = true;
    cancelChatAutoClose();
    const activityAtSend = chatActivityRef.current;
    chatSendsRef.current += 1;
    setConn('busy');
    let replied = false;
    try {
      const b = (await api.trigger(kind)) as Broadcast;
      applyBroadcast(b);
      replied = !b.error;
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
      autoPlayUserInitRef.current = false;
    } finally {
      chatSendsRef.current -= 1;
    }
    if (replied) scheduleChatAutoClose(activityAtSend);
  };

  const cycleSource = async () => {
    const next = nextMusicSource(musicSource, services);
    if (next === musicSource) return;
    playRetuneSound();
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

  const station = useMemo(() => tuneStation(musicSource, steerMood), [musicSource, steerMood]);

  const petState: PetState = talking
    ? 'talking'
    : (playing || segueActive) ? 'playing' : 'idle';
  const controlsDisabled = !isController || conn === 'busy';
  const connLabel = conn === 'on' ? t('connOn') : conn === 'busy' ? t('connBusy') : t('connOff');
  const headerSub = playing && current
    ? current.title
    : conn === 'busy'
      ? t('statusArranging')
      : connLabel;

  return (
    <>
    <WidgetShell voiceDim={talking}>
      <motion.header {...stagger(0)} className="app-header shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className={`header-avatar ${petState !== 'idle' ? 'is-live' : ''}`} aria-hidden>
            <PixelPet state={petState} cell={4} />
          </div>
          <HeaderWeather />
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
          station={station}
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
          sayReveal={sayReveal}
          now={now}
          playing={playing}
          talking={talking}
          conn={conn}
          onSeek={onSeek}
          audioRef={mainCardAudioRef}
          queue={queue}
          queueIndex={queueIndex}
          onPick={(i) => playQueueIndex(i, true)}
          onReorder={reorderUpNext}
          onRemove={removeAt}
          onClear={clearUpNext}
          onSteer={steer}
          onTrigger={trig}
          onResume={resumePlayback}
          isObserver={!isController}
          controlsDisabled={controlsDisabled}
          tasteLine={tasteLine}
          planNote={planNote}
          queueTotal={queueTotal}
        />
      </motion.div>

      {feedbackHint && (
        <motion.p {...stagger(2)} className="text-center text-[11px] text-[rgb(var(--hi-rgb))] font-mono shrink-0">
          {feedbackHint}
        </motion.p>
      )}

      <motion.div {...stagger(3)} className="transport-row shrink-0">
        <PressButton variant="ghost" ariaLabel={t('ariaPrev')} onClick={prev} disabled={controlsDisabled || queueIndex <= 0}>
          <span className="transport-glyph"><IconPrev /></span>
        </PressButton>

        <div className="transport-cluster">
          <PressButton
            variant="ghost"
            ariaLabel={t('ariaLike')}
            onClick={() => emitPlaybackEvent('like', current)}
            disabled={controlsDisabled || !current}
            className={likedKey && current && likedKey === `${current.source}:${current.id}` ? 'is-liked' : ''}
          >
            <span className="transport-glyph">
              <IconHeart
                filled={!!(likedKey && current && likedKey === `${current.source}:${current.id}`)}
              />
            </span>
          </PressButton>
          <PressButton
            variant="play"
            ariaLabel={playing ? t('ariaPause') : t('ariaPlay')}
            onClick={toggle}
            className={playing ? 'is-playing' : ''}
            disabled={controlsDisabled}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={playing ? 'pause' : 'play'}
                className="transport-glyph transport-glyph--play"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={spring.snappy}
              >
                {playing ? <IconPause /> : <IconPlay />}
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
            <span className="transport-glyph"><IconDislike /></span>
          </PressButton>
        </div>

        <PressButton variant="ghost" ariaLabel={t('ariaNext')} onClick={next} disabled={controlsDisabled || (queueIndex < 0 && queueTotal === 0)}>
          <span className="transport-glyph"><IconNext /></span>
        </PressButton>
      </motion.div>

      <motion.div {...stagger(4)} className="shrink-0">
        <PressButton variant="bar" onClick={() => setChatOpen(true)} ariaLabel={t('ariaOpenChat')}>
          <span className="text-[var(--text-muted)] text-[13px] flex-1 text-left truncate">{t('chatBarHint')}</span>
          <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-[0.2em] shrink-0">{t('chatBarLabel')}</span>
        </PressButton>
      </motion.div>

      {/* A/B music elements — audioRef always points at the active one, the
          other is the standby that prefetches and crossfades in. */}
      <audio
        ref={bindMusicA}
        preload="auto"
        onTimeUpdate={(e) => onTime(e.currentTarget)}
        onEnded={(e) => onMusicEnded(e.currentTarget)}
        onError={(e) => onAudioError(e.currentTarget)}
        onWaiting={(e) => onMusicWaiting(e.currentTarget)}
        onStalled={(e) => onMusicWaiting(e.currentTarget)}
        onCanPlay={(e) => onMusicSettled(e.currentTarget)}
        onPlaying={(e) => onMusicSettled(e.currentTarget)}
        onPlay={(e) => onMusicPlay(e.currentTarget)}
        onPause={(e) => onMusicPause(e.currentTarget)}
      />
      <audio
        ref={bindMusicB}
        preload="auto"
        onTimeUpdate={(e) => onTime(e.currentTarget)}
        onEnded={(e) => onMusicEnded(e.currentTarget)}
        onError={(e) => onAudioError(e.currentTarget)}
        onWaiting={(e) => onMusicWaiting(e.currentTarget)}
        onStalled={(e) => onMusicWaiting(e.currentTarget)}
        onCanPlay={(e) => onMusicSettled(e.currentTarget)}
        onPlaying={(e) => onMusicSettled(e.currentTarget)}
        onPlay={(e) => onMusicPlay(e.currentTarget)}
        onPause={(e) => onMusicPause(e.currentTarget)}
      />
      {/* Any way the voice stops — natural end, a skip cancelling the segue
          (pause), or an error — rolls the conductor back: full sentence shows,
          dims release, the pet settles. */}
      <audio
        ref={ttsRef}
        onPlay={() => setTalking(true)}
        onPause={() => { setTalking(false); stopSayReveal(); }}
        onEnded={() => { setTalking(false); stopSayReveal(); }}
        onError={() => { setTalking(false); stopSayReveal(); }}
      />
    </WidgetShell>

    <ChatSheet
      open={chatOpen}
      onClose={() => setChatOpen(false)}
      messages={messages}
      onSend={send}
      onTrigger={trig}
      busy={conn === 'busy'}
      onGoAir={() => trig('station')}
      isObserver={!isController}
      notice={hotlineNotice ? t('hotlineAccepted') : null}
      onInputActivity={() => { chatActivityRef.current += 1; cancelChatAutoClose(); }}
    />
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
