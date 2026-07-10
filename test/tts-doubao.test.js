// 豆包语音 (Doubao TTS) provider: mocked-fetch contract tests. No live API calls —
// we pin the request payload shape, the success path, every failure → null
// (graceful degradation), config gating, and the routing through tts/index.js.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Redirect the disk cache to a temp dir BEFORE any server module is imported
// (config.js resolves DATA_ROOT at import time).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurio-tts-doubao-'));
process.env.AURIO_DATA_DIR = tmpDir;

const { applyOverrides, config } = await import('../server/config.js');
const doubao = await import('../server/tts/doubao.js');
const tts = await import('../server/tts/index.js');

const CACHE_DIR = path.join(tmpDir, 'cache', 'tts');
const AUDIO = Buffer.from('fake-mp3-bytes');

const CONFIGURED = {
  VOICE_PROVIDER: 'doubao',
  DOUBAO_TTS_APPID: 'app-123',
  DOUBAO_TTS_TOKEN: 'tok-456',
  DOUBAO_TTS_VOICE_TYPE: '',
  DOUBAO_TTS_SPEED: '',
  DOUBAO_TTS_EMOTION: '',
  DOUBAO_TTS_CLUSTER: '',
};

function okResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 3000, message: 'Success', data: AUDIO.toString('base64'), ...overrides }),
    text: async () => '',
  };
}

let fetchMock;

beforeEach(() => {
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  applyOverrides(CONFIGURED);
  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal('fetch', fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.AURIO_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('doubao request payload', () => {
  it('posts the documented body shape with bearer-semicolon auth', async () => {
    await doubao.synthesize('晚上好，接下来这首歌送给还没睡的你。');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openspeech.bytedance.com/api/v1/tts');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer;tok-456');
    const body = JSON.parse(opts.body);
    expect(body.app).toEqual({ appid: 'app-123', token: 'tok-456', cluster: 'volcano_tts' });
    expect(body.audio.voice_type).toBe('zh_male_shenyeboke_emo_v2_mars_bigtts'); // 深夜播客 default
    expect(body.audio.encoding).toBe('mp3');
    expect(body.audio.speed_ratio).toBe(0.9); // slightly slow: late-night breaks
    expect(body.audio.emotion).toBeUndefined(); // no emotion forced by default
    expect(body.audio.enable_emotion).toBeUndefined();
    expect(body.request.operation).toBe('query');
    expect(body.request.text).toBe('晚上好，接下来这首歌送给还没睡的你。');
    expect(body.request.reqid).toBeTruthy();
  });

  it('sends emotion + enable_emotion only when an emotion is configured', async () => {
    applyOverrides({ ...CONFIGURED, DOUBAO_TTS_EMOTION: 'coldness', DOUBAO_TTS_SPEED: '1.2' });
    await doubao.synthesize('整点了。');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.audio.enable_emotion).toBe(true);
    expect(body.audio.emotion).toBe('coldness');
    expect(body.audio.speed_ratio).toBe(1.2);
  });

  it('honors a custom voice and cluster (e.g. voice cloning)', async () => {
    applyOverrides({ ...CONFIGURED, DOUBAO_TTS_VOICE_TYPE: 'S_custom1', DOUBAO_TTS_CLUSTER: 'volcano_icl' });
    await doubao.synthesize('测试。');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.audio.voice_type).toBe('S_custom1');
    expect(body.app.cluster).toBe('volcano_icl');
  });
});

describe('doubao success path', () => {
  it('returns a /tts/*.mp3 url and writes the decoded audio to the cache', async () => {
    const out = await doubao.synthesize('第一句。');
    expect(out).toEqual({ url: expect.stringMatching(/^\/tts\/[0-9a-f]{40}\.mp3$/), cached: false });
    const file = path.join(CACHE_DIR, path.basename(out.url));
    expect(fs.readFileSync(file)).toEqual(AUDIO);
  });

  it('serves a second synthesis of the same text from cache without fetching', async () => {
    const first = await doubao.synthesize('同一句话。');
    const again = await doubao.synthesize('同一句话。');
    expect(again).toEqual({ url: first.url, cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keys the cache on voice/emotion/speed so changed settings resynthesize', async () => {
    const a = await doubao.synthesize('你好。');
    applyOverrides({ ...CONFIGURED, DOUBAO_TTS_EMOTION: 'happy' });
    const b = await doubao.synthesize('你好。');
    expect(b.url).not.toBe(a.url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('doubao failure → null (graceful degradation)', () => {
  it('returns null on HTTP error status', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom', json: async () => ({}) });
    expect(await doubao.synthesize('出错吧。')).toBeNull();
  });

  it('returns null on auth failure (401)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => '', json: async () => ({}) });
    expect(await doubao.synthesize('鉴权失败。')).toBeNull();
  });

  it('returns null when the API answers a non-3000 code', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ code: 3050, message: '音色不存在', data: undefined }));
    expect(await doubao.synthesize('坏音色。')).toBeNull();
  });

  it('returns null on a malformed (non-JSON) body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad json'); }, text: async () => '' });
    expect(await doubao.synthesize('坏返回。')).toBeNull();
  });

  it('returns null on timeout', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(timeout);
    expect(await doubao.synthesize('超时。')).toBeNull();
  });

  it('does not write a cache file on failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => '', json: async () => ({}) });
    await doubao.synthesize('失败不落盘。');
    const files = fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : [];
    expect(files).toEqual([]);
  });
});

describe('doubao config gating', () => {
  it('is skipped entirely (no fetch) when appid/token are missing', async () => {
    applyOverrides({ ...CONFIGURED, DOUBAO_TTS_APPID: '', DOUBAO_TTS_TOKEN: '' });
    expect(config.doubao.enabled).toBe(false);
    expect(await doubao.synthesize('没配置。')).toBeNull();
    expect(doubao.cachedSynthesis('没配置。')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores empty text', async () => {
    expect(await doubao.synthesize('   ')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('testVoice reports missing credentials without fetching', async () => {
    applyOverrides({ ...CONFIGURED, DOUBAO_TTS_APPID: '', DOUBAO_TTS_TOKEN: '' });
    const out = await doubao.testVoice({});
    expect(out.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('tts/index.js routing', () => {
  it('routes synthesize and cachedSynthesis to doubao when selected', async () => {
    const out = await tts.synthesize('走门面。');
    expect(out.url).toMatch(/^\/tts\/.*\.mp3$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Facade-level cache hit, no second network call.
    expect(tts.cachedSynthesis('走门面。')).toEqual({ url: out.url, cached: true });
    expect(await tts.synthesize('走门面。')).toEqual({ url: out.url, cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('testVoice uses candidate creds from the settings body', async () => {
    const out = await tts.testVoice({
      VOICE_PROVIDER: 'doubao',
      DOUBAO_TTS_APPID: 'candidate-app',
      DOUBAO_TTS_TOKEN: 'candidate-tok',
      DOUBAO_TTS_VOICE_TYPE: 'zh_female_wanwanxiaohe_moon_bigtts',
    });
    expect(out.ok).toBe(true);
    expect(out.url).toMatch(/^\/tts\/.*\.mp3$/);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.app.appid).toBe('candidate-app');
    expect(body.audio.voice_type).toBe('zh_female_wanwanxiaohe_moon_bigtts');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer;candidate-tok');
  });

  it('summarize() surfaces doubao in the boot features line', async () => {
    const { summarize } = await import('../server/config.js');
    expect(summarize().doubao).toBe(true);
    applyOverrides({ ...CONFIGURED, DOUBAO_TTS_TOKEN: '' });
    expect(summarize().doubao).toBe(false);
  });
});
