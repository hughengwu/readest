// Bundled on-device neural TTS (sherpa-onnx, Android only) as a
// SpeechProvider. The model runs entirely inside the `offline-tts` Tauri
// plugin (Kotlin/JNI); this adapter only talks to it and reshapes its
// response into the provider contract.

import { invoke } from '@tauri-apps/api/core';
import type { TTSVoice } from '../types';
import {
  SpeechProvider,
  SpeechSynthesisPermanentError,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from './types';

const FALLBACK_VOICE_ID = 'offline-melo-zh-en-0';

interface OfflineInitResponse {
  success: boolean;
  sampleRate: number;
}

interface OfflineSynthesizeResponse {
  audioBase64: string;
  sampleRate: number;
}

interface OfflineGetVoicesResponse {
  voices: TTSVoice[];
}

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

export class OfflineTTSProvider implements SpeechProvider {
  readonly id = 'offline-tts';
  readonly label = 'Offline TTS';
  readonly fallbackVoiceId = FALLBACK_VOICE_ID;
  // No persistent cache: synthesis is already local, offline, and effectively
  // instant, so there's nothing a disk cache would save.
  readonly cacheable = false;

  #voices: TTSVoice[] | null = null;

  async init(): Promise<boolean> {
    try {
      const result = await invoke<OfflineInitResponse>('plugin:offline-tts|init');
      return result.success;
    } catch (err) {
      console.warn('Offline TTS unavailable:', err);
      return false;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    if (this.#voices) return this.#voices;
    try {
      const result = await invoke<OfflineGetVoicesResponse>('plugin:offline-tts|get_all_voices');
      this.#voices = result.voices;
      return this.#voices;
    } catch (err) {
      console.warn('Failed to get offline TTS voices:', err);
      return [];
    }
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    _signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    try {
      const result = await invoke<OfflineSynthesizeResponse>('plugin:offline-tts|synthesize', {
        payload: { text: req.text },
      });
      return { audio: base64ToArrayBuffer(result.audioBase64), boundaries: [] };
    } catch (err) {
      // Local, deterministic synthesis: a failure here (bad input, engine
      // fault) will fail again on retry, unlike Edge's transient network
      // errors — skip the sentence instead of burning 3 retries on it.
      const message = err instanceof Error ? err.message : String(err);
      throw new SpeechSynthesisPermanentError(message);
    }
  }
}
