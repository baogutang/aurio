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
import { api, fmt } from './lib/api';
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

  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
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

  const syncQueueState = useCallback((q: Track[], idx: number) => {
    const clean = dedupeQueue(q, idx);
    // Stamp a stable uid on each track so reorder/remove have stable React keys.
    const withUid = clean.queue.map((tk) =>
      tk.uid ? tk : { ...tk, uid: `${tk.source}:${tk.id}:${Math.random().toString(36).slice(2, 8)}` }
    );
    queueRef.current = withUid;
    idxRef.current = clean.index;
    setQueue(withUid);
    setQueueTotal(withUid.length);
    setQueueIndex(clean.index);
  }, []);

  const queueRemaining = queueIndex >= 0
    ? Math.max(0, queueTotal - queueIndex - 1)
    : queueTotal;

  // Queue edits from the player UI (reorder / remove / clear). Update the live
  // refs + state, then persist so a reload keeps the user's edits.
  const applyQueueEdit = useCallback((q: Track[], idx: number) => {
    const clean = dedupeQueue(q, idx);
    queueRef.current = clean.queue;
    idxRef.current = clean.index;
    setQueue(clean.queue);
    setQueueTotal(clean.queue.length);
    setQueueIndex(clean.index);
    api.setQueue(clean.queue).catch(() => {});
  }, []);

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
      ws.send(JSON.stringify({
        type: 'state',
        playingIndex: idxRef.current,
        paused: audioRef.current?.paused ?? true,
        queueLen: queueRef.current.length,
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
    scrobbled.current = false;
    setCurrent(tr);
    setQueueIndex(idx);
    idxRef.current = idx;
    if (tr.segue) setSay(tr.segue);

    const a = audioRef.current!;
    const startSong = () => {
      a.src = tr.url!;
      a.volume = 1;
      a.play()
        .then(() => reportState())
        .catch(() => {
          setPlaying(false);
          setSay(t('sayTapPlay'));
          reportState();
        });
    };

    if (tr.segueTtsUrl && ttsRef.current) {
      ttsRef.current.src = tr.segueTtsUrl;
      ttsRef.current.onended = startSong;
      ttsRef.current.play().catch(startSong);
    } else {
      startSong();
    }
  }, [reportState, t]);

  const startQueue = useCallback((q: Track[], startAt = 0) => {
    if (!q.length) return;
    const idx = Math.max(0, Math.min(startAt, q.length - 1));
    syncQueueState(q, idx);
    playTrack(q[idx], idx);
    reportState();
  }, [syncQueueState, playTrack, reportState]);

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
    const finish = () => {
      if (done) return;
      done = true;
      if (a) a.volume = 1;
      tts.onended = null;
      tts.onerror = null;
      after?.();
    };
    tts.src = url;
    tts.onended = finish;
    tts.onerror = finish;
    tts.play().catch(finish);
  }, []);

  const applyBroadcast = useCallback((b: Broadcast) => {
    if (b.ts && b.ts <= lastBroadcastTs.current) return;
    if (b.ts) lastBroadcastTs.current = b.ts;

    setConn('on');
    setChatOpen(false);
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

    const playTts = (after?: () => void) => playTtsUrl(b.ttsUrl, after);

    switch (b.mode) {
      case 'append': {
        if (b.queue?.length) {
          const merged = [...queueRef.current, ...b.queue];
          const wasIdle = idxRef.current < 0;
          const startAt = merged.length - b.queue.length;
          syncQueueState(merged, wasIdle ? startAt : idxRef.current);
          if (wasIdle) startQueue(merged, startAt);
          reportState();
        }
        return;
      }
      case 'insert': {
        if (b.queue?.length) {
          const wasIdle = idxRef.current < 0;
          const q = [...queueRef.current];
          const at = b.placement === 'append' ? q.length : idxRef.current + 1;
          q.splice(at, 0, ...b.queue);
          if (wasIdle) {
            const startAt = Math.max(0, Math.min(at, q.length - 1));
            syncQueueState(q, startAt);
            playTts(() => startQueue(q, startAt));
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
        const q = b.queue?.length ? b.queue : null;
        if (q) playTts(() => startQueue(q));
        else playTts();
      }
    }
  }, [t, startQueue, syncQueueState, reportState, playTtsUrl]);

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

  const next = () => {
    const q = queueRef.current;
    if (idxRef.current < q.length - 1) {
      const ni = idxRef.current + 1;
      playTrack(q[ni], ni);
    } else if (q.length > 0 && idxRef.current === q.length - 1) {
      reportState();
    }
  };

  const onAudioError = () => {
    setPlaying(false);
    const q = queueRef.current;
    if (idxRef.current >= 0 && idxRef.current < q.length - 1) {
      const ni = idxRef.current + 1;
      setSay(t('sayTrackFailNext'));
      window.setTimeout(() => playTrack(q[ni], ni), 250);
      return;
    }
    setSay(t('sayTrackFail'));
    reportState();
  };

  const prev = () => {
    const q = queueRef.current;
    if (idxRef.current > 0) {
      const pi = idxRef.current - 1;
      playTrack(q[pi], pi);
    }
  };

  const toggle = () => {
    const a = audioRef.current!;
    const q = queueRef.current;
    if (idxRef.current < 0 && q.length) {
      playTrack(q[0], 0);
      return;
    }
    if (a.paused) a.play().catch(() => {});
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
      ws.onopen = () => { setConn('on'); reportState(); };
      ws.onclose = () => { wsRef.current = null; setConn(''); if (!stop) setTimeout(connect, 2000); };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'hello') {
            const q: Track[] = Array.isArray(m.queue) ? m.queue : [];
            syncQueueState(q, idxRef.current >= 0 && idxRef.current < q.length ? idxRef.current : -1);
            reportState();
          }
          if (m.type === 'broadcast') applyBroadcastRef.current(m);
          if (m.type === 'tts') applyTtsPatchRef.current(m);
        } catch (err) {
          console.warn('[Aurio WS] bad message', err);
        }
      };
    };

    connect();
    return () => { stop = true; wsRef.current = null; ws?.close(); };
  }, [syncQueueState, reportState]);

  useEffect(() => {
    api.status().then((s) => {
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
      if (!s?.config?.navidrome && !s?.config?.netease && !s?.config?.qqmusic) {
        setSay(t('sayNoSource'));
      } else {
        setSay(t('sayReady'));
      }
    }).catch(() => {
      setSay(t('sayServerDown'));
      setConn('');
    });
  }, [t]);

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

  // First-run onboarding: only for a fresh, unconfigured install.
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
      if (tr) api.played({ id: tr.id, title: tr.title, artist: tr.artist, source: tr.source });
    }
  };

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
  };

  const send = async (text: string) => {
    primeAudio();
    setMessages((m) => [...m, { role: 'user', text }]);
    setChatOpen(false);
    setConn('busy');
    setSay(t('sayThinking'));
    try {
      const b = (await api.chat(text)) as Broadcast;
      applyBroadcast(b);
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
    }
  };

  const trig = async (kind: string) => {
    primeAudio();
    setChatOpen(false);
    setConn('busy');
    setSay(t('sayArranging'));
    try {
      const b = (await api.trigger(kind)) as Broadcast;
      applyBroadcast(b);
    } catch {
      setSay(t('sayConnFail'));
      setConn('on');
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

  const petState: PetState = conn === 'busy' ? 'talking' : playing ? 'playing' : 'idle';
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

      <motion.div {...stagger(2)} className="min-h-0 flex-1">
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
          onPick={(i) => playTrack(queueRef.current[i], i)}
          onReorder={reorderUpNext}
          onRemove={removeAt}
          onClear={clearUpNext}
        />
      </motion.div>

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

        <PressButton variant="ghost" ariaLabel={t('ariaPrev')} onClick={prev} disabled={queueIndex <= 0}>
          <IconPrev size={17} />
        </PressButton>
        <PressButton
          variant="play"
          ariaLabel={playing ? t('ariaPause') : t('ariaPlay')}
          onClick={toggle}
          className={playing ? 'is-playing' : ''}
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
        <PressButton variant="ghost" ariaLabel={t('ariaNext')} onClick={next} disabled={queueIndex < 0 || queueRemaining === 0}>
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
        onEnded={next}
        onError={onAudioError}
        onPlay={() => { setPlaying(true); reportState(); }}
        onPause={() => { setPlaying(false); reportState(); }}
      />
      <audio ref={ttsRef} />
    </WidgetShell>

    <ChatSheet open={chatOpen} onClose={() => setChatOpen(false)} messages={messages} onSend={send} onTrigger={trig} />
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} currentTrack={current} initialGroup={settingsGroup} />
    <Onboarding
      open={onboard}
      onOpenGroup={(g) => { setSettingsGroup(g); setSettingsOpen(true); }}
      onFinish={async () => { try { await api.saveSettings({ ONBOARDED: '1' }); } catch { /* ignore */ } setOnboard(false); }}
    />
    </>
  );
}
