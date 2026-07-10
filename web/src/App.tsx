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
import { IconChat, IconSettings, IconNext, IconPlay, IconPause, IconHeart, IconDislike } from './components/icons';
import { api, fmt, setWsClientId } from './lib/api';
import { formatNow, type NowDisplay } from './lib/dateFormat';
import { nextMusicSource, postMusicSource, servicesFromModes, type MusicSourceMode, type MusicServices } from './lib/musicSource';
import { spring, stagger } from './lib/motion';
import { cleanSayText } from './lib/highlight';
import { isHotlineAccepted, shouldAutoCloseChat } from './lib/chatFlow';
import { onboardExitAction, firstRunFollowUp, type FirstRunResponse } from './lib/firstRun';
import { coverUrl } from './lib/cover';
import {
  initMixer, resumeMixer, duckMusic, unduckMusic, getMixer,
  setMusicChannelGain, crossfadeMusic, fadeOutMusic, playRetuneSound, type MusicChannel,
} from './lib/audioGraph';
import {
  itemsFrom, skewFrom, programmeAt, nextAfter, upNextTracks, trackOf,
  gainFactorOf, crossfadeSecOf, audibleEndOf, startOf,
  type ProgrammeItem, type ProgrammeSnapshot, type SayEvent,
} from './lib/programme';
import { tuneStation, type StationMood } from './lib/station';
import { useI18n, usePreferences } from './context/PreferencesContext';
import type { Track, SegmentResult, ChatMsg } from './lib/types';

// Gapless handoff tuning: prefetch the next programme item into the standby
// element once its scheduled start is this close, then run the crossfade the
// SCHEDULE prescribes (the segue tail is in the timeline itself). A manual
// skip only gets a quick fade-out so it still feels immediate.
const PREFETCH_WINDOW_SEC = 20;
const MANUAL_FADE_SEC = 0.25;
// Reseek when the media clock drifts this far from the station clock.
const DRIFT_TOLERANCE_SEC = 4;
// Media that dies this long before its scheduled end is unplayable — the
// client asks the station to move on (the log stays honest).
const EARLY_END_SKIP_MS = 5000;
// A voice intro only makes sense near the top of the item; joining mid-song
// must not replay it.
const VOICE_JOIN_WINDOW_MS = 8000;

// After a successful chat reply the sheet lingers this long — enough to see
// the answer land — then closes itself back to the main card (user feedback
// 2026-07-10: 「跟Aurio对话后，聊天框应该随着处理完自动关闭显示主界面」).
const CHAT_AUTOCLOSE_MS = 1000;

const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

type Transition = 'join' | 'auto' | 'manual' | 'cold';

export default function App() {
  const { t, localeTag, locale } = useI18n();
  const { resolved, setTheme, reducedMotion } = usePreferences();
  // audioRef is the stable accessor for THE ACTIVE music element. Two music
  // elements (A/B) alternate underneath so the next item can be prefetched
  // and crossfaded in; everything that asks "what is playing" (heartbeat,
  // MediaSession, tray, the pause/resume guard) reads audioRef.current and
  // keeps working unchanged.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicElsRef = useRef<(HTMLAudioElement | null)[]>([null, null]);
  const activeChRef = useRef<MusicChannel>(0);
  const prefetchRef = useRef<{ url: string } | null>(null);
  const pendingRetireRef = useRef<{ ch: MusicChannel; timer: number } | null>(null);
  const playTokenRef = useRef(0);
  const autoFadeFiredRef = useRef(-1);
  const cancelSegueRef = useRef<(() => void) | null>(null);
  const ttsRef = useRef<HTMLAudioElement>(null);
  const scrobbled = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioPrimed = useRef(false);
  const playbackRecoveryTimer = useRef<number | undefined>(undefined);
  const clientIdRef = useRef('');
  const reconnectDelayRef = useRef(1000);
  const segueActiveRef = useRef(false);

  // --- The programme: the client's slice of the server-authoritative
  // timeline. `skewMs` converts Date.now() into the station's wall clock.
  const programmeRef = useRef<{ items: ProgrammeItem[]; skewMs: number }>({ items: [], skewMs: 0 });
  // The item currently loaded on the active music element (not necessarily
  // the on-air one while paused).
  const playingItemIdRef = useRef<string | null>(null);
  // PAUSE is local — the station never waits. While true, programme pushes
  // update the display but never touch the media.
  const userPausedRef = useRef(false);
  // Voice intros already played (by item id) — an item speaks once.
  const consumedVoiceRef = useRef<Set<string>>(new Set());
  // Transient say lines already displayed / voiced (dedupe between the HTTP
  // reply and the WS 'say' event carrying the same ts).
  const seenSayTsRef = useRef<Set<number>>(new Set());
  const playedSayRef = useRef<Set<string>>(new Set());
  const skipPendingRef = useRef(false);
  const deadAirTimerRef = useRef<number | undefined>(undefined);

  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [segueActive, setSegueActive] = useState(false);
  const [talking, setTalking] = useState(false);
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
  const [upNext, setUpNext] = useState<Track[]>([]);
  const [programmeTotal, setProgrammeTotal] = useState(0);
  // 0..1 fraction of the say text revealed while the DJ voice plays (null = whole).
  const [sayReveal, setSayReveal] = useState<number | null>(null);
  const revealRafRef = useRef(0);
  const revealValRef = useRef<number | null>(null);
  // Bumped whenever audioRef.current points at a different element.
  const [activeElVer, setActiveElVer] = useState(0);

  const serverNow = useCallback(() => Date.now() + programmeRef.current.skewMs, []);

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

  const refreshUpNext = useCallback(() => {
    const { items } = programmeRef.current;
    setUpNext(upNextTracks(items, playingItemIdRef.current));
    setProgrammeTotal(items.length);
  }, []);

  const reportState = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === 1) {
      const audio = audioRef.current;
      const tr = current;
      ws.send(JSON.stringify({
        type: 'state',
        paused: audio?.paused ?? true,
        itemId: playingItemIdRef.current,
        currentTrack: tr ? { id: tr.id, title: tr.title, artist: tr.artist, source: tr.source } : null,
        positionSec: audio?.currentTime ?? 0,
        durationSec: audio && !Number.isNaN(audio.duration) ? audio.duration : 0,
      }));
    }
  }, [current]);
  const reportStateRef = useRef(reportState);
  reportStateRef.current = reportState;

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
  // audio clock. Any interruption rolls back to the whole sentence at once.
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

  const clearPlaybackRecovery = () => {
    if (playbackRecoveryTimer.current) {
      window.clearTimeout(playbackRecoveryTimer.current);
      playbackRecoveryTimer.current = undefined;
    }
  };

  const clearDeadAirTimer = () => {
    if (deadAirTimerRef.current !== undefined) {
      window.clearTimeout(deadAirTimerRef.current);
      deadAirTimerRef.current = undefined;
    }
  };

  // Seek a media element to a position, robust against metadata not being
  // loaded yet (the seek is re-applied once it is).
  const seekTo = (el: HTMLAudioElement, seconds: number) => {
    if (seconds <= 0.05) return;
    const apply = () => { try { el.currentTime = seconds; } catch { /* noop */ } };
    if (el.readyState >= 1) apply();
    else el.addEventListener('loadedmetadata', apply, { once: true });
  };

  /**
   * Start one programme item at a media offset. The station said WHAT and
   * WHEN; this is the HOW — standby element, equal-power crossfade of the
   * length the schedule embeds, per-track loudness gain, and the item's voice
   * intro ducked over the transition.
   */
  const playItem = useCallback((item: ProgrammeItem, offsetMs: number, opts?: { transition?: Transition; fadeSec?: number }) => {
    const tr = trackOf(item);
    if (!tr?.url) {
      setPlaying(false);
      setSay(t('sayTrackFail'));
      return;
    }
    clearPlaybackRecovery();
    clearDeadAirTimer();
    cancelSegueRef.current?.();
    scrobbled.current = false;
    playTokenRef.current += 1;
    setCurrent(tr);
    playingItemIdRef.current = item.id;
    refreshUpNext();
    if (tr.segue) setSay(tr.segue);

    const transition = opts?.transition ?? 'manual';
    const seekSec = Math.max(0, offsetMs) / 1000;
    const nearTop = offsetMs - item.cueIn < VOICE_JOIN_WINDOW_MS;
    const wantVoice = !!(tr.segueTtsUrl && ttsRef.current && nearTop && !consumedVoiceRef.current.has(item.id));
    const gain = gainFactorOf(item);

    const emitStarted = () => {
      api.playbackEvent({
        event: 'started',
        track: { id: tr.id, title: tr.title, artist: tr.artist, source: tr.source },
      }).catch(() => {});
    };

    if (!getMixer()) {
      // Fallback: mixer failed to init (autoplay/CSP edge) — keep the
      // single-element hard cut. audioRef never flips in this mode.
      const a = audioRef.current;
      if (!a) return;
      const startSong = () => {
        segueActiveRef.current = false;
        setSegueActive(false);
        a.src = tr.url!;
        seekTo(a, seekSec);
        resumeMixer();
        unduck(a);
        emitStarted();
        a.play()
          .then(() => reportStateRef.current())
          .catch(() => {
            setPlaying(false);
            setSay(t('sayTapPlay'));
            reportStateRef.current();
          });
      };
      if (wantVoice) {
        consumedVoiceRef.current.add(item.id);
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

    // Mixer path: the incoming item starts on the standby element and the two
    // channel gains carry the transition — the schedule's own crossfade on a
    // natural boundary, a quick fade-out on a manual skip, a hard cut after a
    // cold ending. Never a hard `src` cut on a live element.
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
      seekTo(incoming, seekSec);

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
        const fade = transition === 'auto'
          ? (opts?.fadeSec ?? 2)
          : transition === 'cold' ? 0.02 : MANUAL_FADE_SEC;
        if (transition === 'auto') {
          crossfadeMusic(outCh, inCh, fade, gain);
        } else {
          setMusicChannelGain(inCh, gain);
          fadeOutMusic(outCh, Math.max(fade, 0.02));
        }
        pendingRetireRef.current = {
          ch: outCh,
          timer: window.setTimeout(() => {
            pendingRetireRef.current = null;
            retireChannel(outCh);
          }, fade * 1000 + 150),
        };
      } else {
        setMusicChannelGain(inCh, gain);
        retireChannel(outCh);
      }

      emitStarted();
      incoming.play()
        .then(() => reportStateRef.current())
        .catch(() => {
          setPlaying(false);
          setSay(t('sayTapPlay'));
          reportStateRef.current();
        });
    };

    if (wantVoice) {
      // The crossfade IS the bed under her voice: the A→B transition runs
      // while she talks and the duck on the shared music bus keeps it low, so
      // she is never speaking into silence.
      consumedVoiceRef.current.add(item.id);
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
  }, [t, duck, unduck, retireChannel, finalizePendingRetire, startSayReveal, stopSayReveal, refreshUpNext]);

  const playItemRef = useRef(playItem);
  playItemRef.current = playItem;

  /**
   * Reconcile playback with a programme snapshot. The server (or the local
   * schedule) said what is on air; this decides whether the media needs to
   * move. PAUSE is local: a paused player only updates the display.
   */
  const applyProgramme = useCallback((snap: ProgrammeSnapshot) => {
    programmeRef.current = {
      items: itemsFrom(snap),
      skewMs: skewFrom(snap, Date.now()),
    };
    clearDeadAirTimer();
    const cur = snap.current;

    if (!cur) {
      // Dead air. If something is scheduled ahead, arm a rejoin at its start.
      refreshUpNext();
      const future = programmeRef.current.items.find((it) => (startOf(it) ?? -Infinity) > serverNow());
      if (future && !userPausedRef.current) {
        const wait = Math.max(0, (startOf(future) as number) - serverNow());
        deadAirTimerRef.current = window.setTimeout(() => {
          deadAirTimerRef.current = undefined;
          const at = programmeAt(programmeRef.current.items, serverNow());
          if (at.current && !userPausedRef.current) playItemRef.current(at.current, at.offsetMs, { transition: 'manual' });
        }, wait + 30);
      }
      return;
    }

    if (cur.id === playingItemIdRef.current) {
      // Same item: adopt new metadata (a voice may have just arrived), then
      // correct drift if the media clock wandered off the station clock.
      const tr = trackOf(cur);
      if (tr) setCurrent(tr);
      refreshUpNext();
      const a = audioRef.current;
      if (a && !a.paused) {
        const s = startOf(cur);
        if (s != null) {
          const expected = (cur.cueIn + (serverNow() - s)) / 1000;
          if (
            Number.isFinite(a.duration) && expected < a.duration &&
            Math.abs(a.currentTime - expected) > DRIFT_TOLERANCE_SEC
          ) {
            a.currentTime = expected;
          }
        }
      }
      return;
    }

    // A different item is on air.
    if (userPausedRef.current) {
      // Display follows the station; the media stays paused.
      const tr = trackOf(cur);
      if (tr) setCurrent(tr);
      refreshUpNext();
      return;
    }
    const wasLive = !!playingItemIdRef.current;
    playItemRef.current(cur, snap.offsetMs, { transition: wasLive ? 'manual' : 'join' });
  }, [refreshUpNext, serverNow]);

  const applyProgrammeRef = useRef(applyProgramme);
  applyProgrammeRef.current = applyProgramme;

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

  // A transient spoken line — the host talking over the bed NOW (chat answers,
  // scheduled beats). Reaches us twice for our own requests (HTTP reply + WS
  // 'say'), so text and voice each dedupe.
  const applySay = useCallback((s: SayEvent) => {
    const text = s.text ? cleanSayText(s.text) : '';
    if (text && s.ts && !seenSayTsRef.current.has(s.ts)) {
      seenSayTsRef.current.add(s.ts);
      setSay(text);
      setMessages((m) => [...m, { role: 'dj', text }]);
    } else if (text && !s.ts) {
      setSay(text);
    }
    if (s.ttsUrl) {
      const key = `${s.ts ?? 0}:${s.ttsUrl}`;
      if (!playedSayRef.current.has(key)) {
        playedSayRef.current.add(key);
        playTtsUrl(s.ttsUrl, undefined, { reveal: !!text });
      }
    }
  }, [playTtsUrl]);

  const applySayRef = useRef(applySay);
  applySayRef.current = applySay;

  // The /api/chat and /api/trigger replies: display + voice the say (the
  // programme itself arrives over the WS as its own push).
  const applySegmentResult = useCallback((b: SegmentResult) => {
    setConn('on');
    if (b.error) {
      setSay(b.say ? cleanSayText(b.say) : t('sayError'));
      return;
    }
    applySay({ ts: b.ts, kind: b.kind, text: b.say, ttsUrl: b.ttsUrl });
  }, [applySay, t]);

  const refreshTaste = useCallback(() => {
    api.taste().then((r) => {
      const parts: string[] = [];
      if (r?.liked?.length) parts.push(r.liked.slice(0, 2).map((x) => x.name).join('、'));
      if (r?.avoidArtists?.length) parts.push(`避开 ${r.avoidArtists.slice(0, 2).map((a) => a.artist).join('、')}`);
      setTasteLine(parts.length ? parts.join(' · ') : '');
    }).catch(() => {});
  }, []);

  const emitPlaybackEvent = useCallback((event: 'started' | 'completed' | 'skipped' | 'replayed' | 'like' | 'dislike', track?: Track | null) => {
    const tr = track || current;
    if (!tr?.id) return;
    const a = audioRef.current;
    api.playbackEvent({
      event,
      track: { id: tr.id, title: tr.title, artist: tr.artist, source: tr.source },
      position_sec: a?.currentTime || 0,
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
  }, [t, refreshTaste, current]);

  // Skip is a station operation: the on-air item ends now — for every
  // listener. The HTTP reply is a fresh programme snapshot, so the local
  // player reconciles immediately without waiting for the WS push.
  const requestSkip = useCallback(async () => {
    if (skipPendingRef.current) return;
    skipPendingRef.current = true;
    try {
      const snap = await api.skip();
      if (snap?.serverNow) applyProgrammeRef.current(snap);
    } catch { /* the WS push will still arrive */ }
    finally {
      skipPendingRef.current = false;
    }
  }, []);

  const next = () => {
    if (current) emitPlaybackEvent('skipped', current);
    void requestSkip();
  };

  const pauseLocal = () => {
    userPausedRef.current = true;
    audioRef.current?.pause();
  };

  // PLAY rejoins the live edge — the station never waited. The local schedule
  // knows where the cursor is without a round-trip.
  const rejoinLive = () => {
    userPausedRef.current = false;
    primeAudio();
    const at = programmeAt(programmeRef.current.items, serverNow());
    if (at.current) {
      playItem(at.current, at.offsetMs, { transition: 'manual' });
      return;
    }
    // Nothing on air right now — ask the server for a fresh view (the log may
    // have moved on while we were away from the WS).
    api.programme().then((snap) => {
      if (snap?.serverNow) applyProgrammeRef.current(snap);
    }).catch(() => {});
  };

  const toggle = () => {
    const a = audioRef.current;
    if (a && !a.paused) pauseLocal();
    else rejoinLive();
  };

  const onAudioError = (el: HTMLAudioElement) => {
    if (el !== audioRef.current) {
      // The standby prefetch failed — forget it. The boundary then falls back
      // to an ordinary start instead of a prefetched crossfade.
      prefetchRef.current = null;
      return;
    }
    clearPlaybackRecovery();
    setPlaying(false);
    // The media is unplayable: ask the station to move on. The log records an
    // honest short airing and every listener advances together.
    setSay(t('sayTrackFailNext'));
    void requestSkip();
  };

  const schedulePlaybackRecovery = () => {
    clearPlaybackRecovery();
    playbackRecoveryTimer.current = window.setTimeout(() => {
      const a = audioRef.current;
      if (!a || a.paused) return;
      if (a.readyState < 3) onAudioError(a);
    }, 10000);
  };

  // Transport handlers are re-created every render; keep them in refs so the
  // stable media-key effect always calls the current closure.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const nextRef = useRef(next);
  nextRef.current = next;

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
        reportStateRef.current();
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
            reportStateRef.current();
          }
          if (m.type === 'programme') applyProgrammeRef.current(m as ProgrammeSnapshot);
          if (m.type === 'say') applySayRef.current(m as SayEvent);
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
  }, []);

  useEffect(() => {
    if (conn !== 'on') return;
    const timer = window.setInterval(() => reportStateRef.current(), 8000);
    return () => window.clearInterval(timer);
  }, [conn]);

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
    navigator.mediaSession.setActionHandler('play', () => rejoinLive());
    navigator.mediaSession.setActionHandler('pause', () => pauseLocal());
    // prev is gone: radio does not rewind (the tape feature will, later).
    navigator.mediaSession.setActionHandler('previoustrack', null);
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
    };
  }, [current, playing, segueActive]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (cmd === 'playpause') toggleRef.current();
      else if (cmd === 'next') nextRef.current();
      else if (cmd === 'stop') { userPausedRef.current = true; audioRef.current?.pause(); }
      // 'prev' intentionally ignored — the station does not rewind.
    });
    return () => { unsub?.(); };
  }, []);

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
      if (s?.musicSource === 'netease' || s?.musicSource === 'navidrome' || s?.musicSource === 'qqmusic' || s?.musicSource === 'combined') {
        setMusicSource(s.musicSource);
      }
      if (announce && !playingItemIdRef.current) {
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

  useEffect(() => () => { clearPlaybackRecovery(); clearDeadAirTimer(); }, []);

  useEffect(() => {
    if (!playing) return;
    let lock: WakeLockSentinel | null = null;
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    }
    return () => { lock?.release().catch(() => {}); };
  }, [playing]);

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
    if (!scrobbled.current && a.currentTime > 20 && current) {
      scrobbled.current = true;
      api.played({
        id: current.id,
        title: current.title,
        artist: current.artist,
        source: current.source,
        position_sec: a.currentTime,
      });
    }

    // Schedule-driven handoff: the timeline says when the next item starts
    // (the crossfade is IN the schedule — scheduledStart is the previous
    // item's segue point). Prefetch into the standby element as the boundary
    // approaches, then hand off exactly at it.
    if (a.paused || userPausedRef.current) return;
    const { items } = programmeRef.current;
    const playingId = playingItemIdRef.current;
    const idx = items.findIndex((it) => it.id === playingId);
    if (idx < 0) return;
    const cur_ = items[idx];
    const nextIt = nextAfter(items, playingId);
    if (!nextIt || startOf(nextIt) == null) return;
    const untilNext = (startOf(nextIt) as number) - serverNow();

    if (getMixer() && !pendingRetireRef.current) {
      const standby = musicElsRef.current[activeChRef.current === 0 ? 1 : 0];
      const nextUrl = nextIt.streamUrl || nextIt.track?.url;
      if (standby && nextUrl && untilNext <= PREFETCH_WINDOW_SEC * 1000) {
        if (prefetchRef.current?.url !== nextUrl) {
          prefetchRef.current = { url: nextUrl };
          standby.preload = 'auto';
          standby.src = nextUrl;
        }
      }
    }

    if (untilNext <= 0 && autoFadeFiredRef.current !== playTokenRef.current) {
      autoFadeFiredRef.current = playTokenRef.current;
      const cold = cur_.endType === 'cold';
      playItem(nextIt, nextIt.cueIn, {
        transition: cold ? 'cold' : 'auto',
        fadeSec: crossfadeSecOf(cur_),
      });
    }
  };

  // Both music elements share these handlers; only the active element drives
  // app state, so the outgoing element of a crossfade (its late pause/ended
  // events) and the standby prefetch never disturb playback state.
  const onMusicEnded = (el: HTMLAudioElement) => {
    if (el !== audioRef.current) return;
    const { items } = programmeRef.current;
    const it = items.find((x) => x.id === playingItemIdRef.current);
    const t_ = serverNow();
    if (it && audibleEndOf(it) - t_ > EARLY_END_SKIP_MS) {
      // The media ran out long before the schedule says it should (a lying
      // duration, e.g. a 30s preview): the station moves on for everyone.
      emitPlaybackEvent('completed', current);
      void requestSkip();
      return;
    }
    emitPlaybackEvent('completed', current);
    // Natural end. If the boundary handler didn't already fire (no overlap /
    // timing jitter), start whatever the schedule says is on now.
    const at = programmeAt(items, t_ + 50);
    if (at.current && at.current.id !== playingItemIdRef.current && !userPausedRef.current) {
      playItem(at.current, at.offsetMs, { transition: 'manual' });
      return;
    }
    reportStateRef.current();
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
    reportStateRef.current();
  };
  const onMusicPause = (el: HTMLAudioElement) => {
    if (el !== audioRef.current) return;
    clearPlaybackRecovery();
    // Pausing mid-crossfade must silence the outgoing tail too.
    finalizePendingRetire();
    if (!segueActiveRef.current) setPlaying(false);
    reportStateRef.current();
  };

  // Steering the programming is turning the dial: nudge the pseudo-FM
  // frequency and play the retune burst. Only user-initiated switches sound —
  // this runs from chip clicks, never on mount or on server pushes.
  const steer = async (text: string, mood?: StationMood) => {
    primeAudio();
    userPausedRef.current = false;
    if (mood) {
      setSteerMood(mood);
      playRetuneSound();
    }
    setConn('busy');
    try {
      const b = await api.chat(text);
      applySegmentResult(b);
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
    }
  };

  // --- Chat sheet auto-close --------------------------------------------
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

  useEffect(() => {
    if (!chatOpen) {
      cancelChatAutoClose();
      setHotlineNotice(false);
    }
  }, [chatOpen, cancelChatAutoClose]);
  useEffect(() => cancelChatAutoClose, [cancelChatAutoClose]);

  const send = async (text: string) => {
    primeAudio();
    userPausedRef.current = false;
    setMessages((m) => [...m, { role: 'user', text }]);
    setHotlineNotice(false);
    cancelChatAutoClose();
    const activityAtSend = chatActivityRef.current;
    chatSendsRef.current += 1;
    setConn('busy');
    let replied = false;
    try {
      const b = await api.chat(text);
      applySegmentResult(b);
      // 热线接受确认: the DJ queued the request for later — show the state line.
      if (isHotlineAccepted(b)) setHotlineNotice(true);
      replied = !b.error;
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
    } finally {
      chatSendsRef.current -= 1;
    }
    if (replied) scheduleChatAutoClose(activityAtSend);
  };

  const trig = async (kind: string) => {
    primeAudio();
    userPausedRef.current = false;
    cancelChatAutoClose();
    const activityAtSend = chatActivityRef.current;
    chatSendsRef.current += 1;
    setConn('busy');
    let replied = false;
    try {
      const b = await api.trigger(kind);
      applySegmentResult(b);
      replied = !b.error;
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
    } finally {
      chatSendsRef.current -= 1;
    }
    if (replied) scheduleChatAutoClose(activityAtSend);
  };

  // 开台仪式 (RADIO_VISION §六): the one-time first-run trigger. Mirrors trig()
  // minus the chat-sheet bookkeeping. The server performs the ceremony (scan
  // fact + first songs) through the normal segment flow; a guard hit (same
  // data dir, ceremony already performed) falls back to today's station open,
  // and any failure lands on the standby screen — never a trap.
  const goLiveFirstRun = async () => {
    setConn('busy');
    setSay(t('sayOpening'));
    try {
      const b = (await api.trigger('first-run')) as FirstRunResponse;
      if (firstRunFollowUp(b) === 'station') {
        void trig('station');
        return;
      }
      applySegmentResult(b);
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
    }
  };

  // Leaving the onboarding sheet.「开台」fires the ceremony;「跳过」keeps
  // today's behaviour exactly (ONBOARDED + plain station open). primeAudio()
  // runs synchronously inside the tap gesture, before any await.
  const finishOnboarding = async (goLive: boolean) => {
    const action = onboardExitAction({ goLive, isController: true });
    if (action === 'first-run') primeAudio();
    try { await api.saveSettings({ ONBOARDED: '1' }); } catch { /* ignore */ }
    setOnboard(false);
    if (action === 'station') {
      void trig('station');
    } else if (action === 'first-run') {
      void goLiveFirstRun();
    }
  };

  const cycleSource = async () => {
    const nextSrc = nextMusicSource(musicSource, services);
    if (nextSrc === musicSource) return;
    playRetuneSound();
    setMusicSource(nextSrc);
    try {
      const r = await postMusicSource(nextSrc);
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
  const controlsDisabled = conn === 'busy';
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
          queueTotal={programmeTotal}
          queueRemaining={upNext.length}
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
          audioRef={mainCardAudioRef}
          upNext={upNext}
          onSteer={steer}
          onTrigger={trig}
          onResume={rejoinLive}
          controlsDisabled={controlsDisabled}
          tasteLine={tasteLine}
          planNote={planNote}
          queueTotal={programmeTotal}
        />
      </motion.div>

      {feedbackHint && (
        <motion.p {...stagger(2)} className="text-center text-[11px] text-[rgb(var(--hi-rgb))] font-mono shrink-0">
          {feedbackHint}
        </motion.p>
      )}

      <motion.div {...stagger(3)} className="transport-row shrink-0">
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
            void requestSkip();
          }} disabled={controlsDisabled || !current}>
            <span className="transport-glyph"><IconDislike /></span>
          </PressButton>
        </div>

        <PressButton variant="ghost" ariaLabel={t('ariaNext')} onClick={next} disabled={controlsDisabled || !current}>
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
      isObserver={false}
      notice={hotlineNotice ? t('hotlineAccepted') : null}
      onInputActivity={() => { chatActivityRef.current += 1; cancelChatAutoClose(); }}
    />
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} currentTrack={current} initialGroup={settingsGroup} />
    <Onboarding
      open={onboard}
      onOpenGroup={(g) => { setSettingsGroup(g); setSettingsOpen(true); }}
      onGoLive={() => { void finishOnboarding(true); }}
      onSkip={() => { void finishOnboarding(false); }}
    />
    </>
  );
}
