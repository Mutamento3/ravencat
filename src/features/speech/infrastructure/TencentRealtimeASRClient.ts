export type TencentRealtimeASRSliceType = 0 | 1 | 2;

export type TencentRealtimeASRAudioChunk = ArrayBuffer | ArrayBufferView | Blob;

export interface TencentRealtimeASRResult {
  sliceType: TencentRealtimeASRSliceType;
  index: number;
  startTime: number;
  endTime: number;
  text: string;
  stable: boolean;
  raw: TencentRealtimeASRMessage;
}

export interface TencentRealtimeASRMessage {
  code?: number;
  message?: string;
  voice_id?: string;
  message_id?: string;
  final?: number;
  result?: {
    slice_type?: number;
    index?: number;
    start_time?: number;
    end_time?: number;
    voice_text_str?: string;
  };
}

export interface TencentRealtimeASRClientHandlers {
  onReady?: (message: TencentRealtimeASRMessage) => void;
  onSpeechStart?: (result: TencentRealtimeASRResult) => void;
  onInterimResult?: (result: TencentRealtimeASRResult) => void;
  onFinalResult?: (result: TencentRealtimeASRResult) => void;
  onFinished?: (message: TencentRealtimeASRMessage) => void;
  onError?: (error: Error) => void;
  onClosed?: () => void;
}

export interface TencentRealtimeASRClientConfig {
  signedUrl: string;
  handlers?: TencentRealtimeASRClientHandlers;
}

export interface TencentRealtimeASRConnection {
  sendAudioChunk(chunk: TencentRealtimeASRAudioChunk): void;
  finish(): void;
  close(): void;
}

export class TencentRealtimeASRClient {
  constructor(private readonly config: TencentRealtimeASRClientConfig) {}

  connect(signal?: AbortSignal): Promise<TencentRealtimeASRConnection> {
    if (signal?.aborted) return Promise.reject(new Error('Tencent realtime ASR connection cancelled'));
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.config.signedUrl);
      const handlers = this.config.handlers ?? {};
      let ready = false;
      let closed = false;
      let finished = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        socket.close();
      };
      const fail = (error: Error) => {
        if (closed) return;
        if (!ready) reject(error);
        handlers.onError?.(error);
        close();
      };
      const cancel = () => {
        if (!ready) reject(new Error('Tencent realtime ASR connection cancelled'));
        close();
      };
      const timer = setTimeout(() => fail(new Error('Tencent realtime ASR connection timeout')), 15_000);
      signal?.addEventListener('abort', cancel, { once: true });
      socket.onmessage = (event) => {
        if (closed) return;
        try {
          const message = parseTencentRealtimeASRMessage(event.data);
          if (message.code !== undefined && message.code !== 0) {
            fail(new Error(message.message || `Tencent realtime ASR error: ${message.code}`));
            return;
          }
          if (!ready) {
            if (message.code !== 0) throw new Error('Invalid Tencent realtime ASR handshake');
            ready = true;
            clearTimeout(timer);
            handlers.onReady?.(message);
            resolve({ sendAudioChunk: (chunk) => socket.send(chunk as any), finish: () => socket.send(JSON.stringify({ type: 'end' })), close });
          }
          if (message.final === 1) {
            finished = true;
            handlers.onFinished?.(message);
            return;
          }
          const result = toTencentRealtimeASRResult(message);
          if (!result) return;
          if (result.sliceType === 0) handlers.onSpeechStart?.(result);
          else if (result.sliceType === 1) handlers.onInterimResult?.(result);
          else handlers.onFinalResult?.(result);
        } catch (error) { fail(error instanceof Error ? error : new Error('Invalid Tencent realtime ASR response')); }
      };
      socket.onerror = () => fail(new Error('Tencent realtime ASR WebSocket failed'));
      socket.onclose = () => {
        if (!closed && !finished) fail(new Error('Tencent realtime ASR connection closed before final result'));
        close();
        handlers.onClosed?.();
      };
    });
  }
}

export function createTencentRealtimeASRClient(
  config: TencentRealtimeASRClientConfig
): TencentRealtimeASRClient {
  return new TencentRealtimeASRClient(config);
}

function parseTencentRealtimeASRMessage(data: unknown): TencentRealtimeASRMessage {
  if (typeof data !== 'string') {
    throw new Error('Invalid Tencent realtime ASR message: expected JSON text');
  }
  const parsed = JSON.parse(data) as TencentRealtimeASRMessage;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid Tencent realtime ASR message');
  return parsed;
}

function toTencentRealtimeASRResult(
  message: TencentRealtimeASRMessage
): TencentRealtimeASRResult | null {
  const result = message.result;
  const sliceType = result?.slice_type;
  if (sliceType !== 0 && sliceType !== 1 && sliceType !== 2) {
    return null;
  }

  if (!Number.isInteger(result.index) || typeof result.voice_text_str !== 'string' || !Number.isFinite(result.start_time) || !Number.isFinite(result.end_time)) throw new Error('Invalid Tencent realtime ASR transcript');
  return {
    sliceType,
    index: result.index!,
    startTime: result.start_time!,
    endTime: result.end_time!,
    text: result.voice_text_str.trim(),
    stable: sliceType === 2,
    raw: message,
  };
}
