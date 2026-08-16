import { beforeEach, describe, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }));

import { OfflineTTSProvider } from '@/services/tts/providers/offlineTts';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';

describe('OfflineTTSProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('identifies as offline-tts with a label and fallback voice', () => {
    const provider = new OfflineTTSProvider();
    expect(provider.id).toBe('offline-tts');
    expect(provider.label).toBe('Offline TTS');
    expect(provider.fallbackVoiceId).toBeTruthy();
    expect(provider.cacheable).toBe(false);
  });

  test('init resolves true when the plugin reports success', async () => {
    h.invoke.mockResolvedValue({ success: true, sampleRate: 44100 });
    const provider = new OfflineTTSProvider();
    await expect(provider.init()).resolves.toBe(true);
    expect(h.invoke).toHaveBeenCalledWith('plugin:offline-tts|init');
  });

  test('init resolves false when the plugin invoke rejects (e.g. non-Android)', async () => {
    h.invoke.mockRejectedValue(new Error('plugin not found'));
    const provider = new OfflineTTSProvider();
    await expect(provider.init()).resolves.toBe(false);
  });

  test('getAllVoices returns the plugin voice list and caches it', async () => {
    const voices = [{ id: 'offline-melo-zh-en-0', name: '离线中文语音', lang: 'zh-CN' }];
    h.invoke.mockResolvedValue({ voices });
    const provider = new OfflineTTSProvider();

    await expect(provider.getAllVoices()).resolves.toEqual(voices);
    await expect(provider.getAllVoices()).resolves.toEqual(voices);
    // Cached after the first call.
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  test('getAllVoices returns an empty list when the plugin invoke rejects', async () => {
    h.invoke.mockRejectedValue(new Error('plugin not found'));
    const provider = new OfflineTTSProvider();
    await expect(provider.getAllVoices()).resolves.toEqual([]);
  });

  test('synthesize sends only the text and decodes the base64 WAV response', async () => {
    // Bytes [1, 2, 3, 4] base64-encoded.
    h.invoke.mockResolvedValue({ audioBase64: 'AQIDBA==', sampleRate: 44100 });
    const provider = new OfflineTTSProvider();

    const result = await provider.synthesize(
      { lang: 'zh', text: '你好世界', voice: 'offline-melo-zh-en-0', pitch: 1.0 },
      new AbortController().signal,
    );

    expect(h.invoke).toHaveBeenCalledWith('plugin:offline-tts|synthesize', {
      payload: { text: '你好世界' },
    });
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([1, 2, 3, 4]));
    // No native word-boundary timestamps: highlighting degrades to sentence level.
    expect(result.boundaries).toEqual([]);
  });

  test('maps any synthesis failure to SpeechSynthesisPermanentError', async () => {
    // Local, deterministic synthesis: unlike Edge's network errors, a failure
    // here will fail again on retry, so the client should skip, not retry.
    h.invoke.mockRejectedValue(new Error('Offline TTS is not initialized'));
    const provider = new OfflineTTSProvider();

    await expect(
      provider.synthesize(
        { lang: 'zh', text: '你好', voice: 'offline-melo-zh-en-0', pitch: 1.0 },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
  });
});
