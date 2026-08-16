import { AppService } from '@/types/system';
import { BufferedTTSClient } from './BufferedTTSClient';
import { OfflineTTSProvider } from './providers/offlineTts';
import { TTSController } from './TTSController';

// Same re-homing shape as EdgeTTSClient: BufferedTTSClient owns every
// engine-independent concern (scheduling, decode, WSOLA, word tracking), this
// just keeps the persisted 'offline-tts' client name. Unlike Edge, no
// transport fallback or persistent cache is needed — synthesis is already
// local, offline, and effectively instant.
//
// Also gives this engine its own mockable module (mirrors EdgeTTSClient /
// NativeTTSClient / WebSpeechClient), so tests that mock all four client
// modules never need to load the real BufferedTTSClient graph.
export class OfflineTTSClient extends BufferedTTSClient {
  constructor(controller?: TTSController, appService?: AppService | null) {
    super(new OfflineTTSProvider(), controller, appService);
  }
}
