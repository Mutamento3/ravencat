import { createRandomUUID } from '@platform/device';
import type {
  RealtimeRecognitionConnection,
  RealtimeRecognitionHandlers,
  SpeechConnectionConfig,
  SpeechMetadata,
} from '../domain/SpeechProvider';

/** 只有 task-started 才允许音频进入；task-finished 是最后一句结果的完成屏障。 */
export function connectDashScopeRealtimeASR(
  config: SpeechConnectionConfig,
  metadata: SpeechMetadata,
  handlers: RealtimeRecognitionHandlers,
  signal?: AbortSignal,
): Promise<RealtimeRecognitionConnection> {
  if (signal?.aborted) return Promise.reject(new Error('实时语音识别已取消'));
  return new Promise((resolve, reject) => {
    const taskId = createRandomUUID();
    // React Native 的 WebSocket 支持握手 headers，浏览器实现不承担 Android 的连接契约。
    const NativeWebSocket = WebSocket as unknown as {
      new (url: string, protocols: null, options: { headers: Record<string, string> }): WebSocket;
    };
    const socket = new NativeWebSocket(config.baseURL, null, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    let ready = false;
    let closed = false;
    let finished = false;
    let lastSentenceStart: number | undefined;
    let startupTimer: ReturnType<typeof setTimeout>;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(startupTimer);
      signal?.removeEventListener('abort', cancel);
      socket.close();
    };
    const fail = (error: Error) => {
      if (closed) return;
      if (!ready) reject(error);
      else handlers.onError?.(error);
      close();
    };
    const cancel = () => {
      if (!ready) reject(new Error('实时语音识别已取消'));
      close();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    startupTimer = setTimeout(() => fail(new Error('实时语音识别连接超时')), 15_000);
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
          payload: {
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            model: config.model,
            input: {},
            parameters: {
              format: 'pcm',
              sample_rate: 16000,
              ...(metadata.vocabularyId ? { vocabulary_id: metadata.vocabularyId } : {}),
              ...(metadata.maxSentenceSilence != null
                ? { max_sentence_silence: metadata.maxSentenceSilence }
                : {}),
            },
          },
        }),
      );
    socket.onmessage = (event) => {
      if (closed) return;
      try {
        const message = JSON.parse(event.data);
        if (message.header.task_id !== taskId) throw new Error('实时识别返回了不匹配的任务 ID');
        switch (message.header.event) {
          case 'task-started':
            clearTimeout(startupTimer);
            ready = true;
            resolve({
              sendAudioChunk: (chunk) => socket.send(chunk),
              finish: () =>
                socket.send(
                  JSON.stringify({
                    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
                    payload: { input: {} },
                  }),
                ),
              close,
            });
            break;
          case 'result-generated': {
            const sentence = message.payload.output.sentence;
            if (sentence.heartbeat) break;
            // Paraformer 用 begin_time 标识同一句；Fun-ASR 提供独立 sentence_id。
            const paraformer = config.model.startsWith('paraformer-');
            const index = paraformer ? sentence.begin_time : sentence.sentence_id;
            if (
              !Number.isInteger(index) ||
              typeof sentence.text !== 'string' ||
              !Number.isFinite(sentence.begin_time) ||
              typeof sentence.sentence_end !== 'boolean'
            )
              throw new Error('实时识别返回了无效文本');
            const result = {
              index,
              text: sentence.text,
              startTime: sentence.begin_time,
              endTime: sentence.end_time ?? sentence.begin_time,
            };
            if (paraformer ? lastSentenceStart !== sentence.begin_time : sentence.sentence_begin)
              handlers.onSpeechStart?.(result);
            lastSentenceStart = sentence.begin_time;
            if (sentence.sentence_end) handlers.onFinalTranscript?.(result);
            else handlers.onInterimTranscript?.(result);
            break;
          }
          case 'task-finished':
            finished = true;
            handlers.onFinished?.();
            break;
          case 'task-failed':
            fail(new Error(`阿里百炼 STT ${message.header.error_code}: ${message.header.error_message}`));
            break;
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error('实时识别响应格式无效'));
      }
    };
    socket.onerror = (event) => fail(new Error(`阿里百炼实时语音识别 WebSocket 网络失败：${(event as Event & { message?: string }).message || '原生连接未提供具体原因'}`));
    socket.onclose = (event) => {
      if (!closed && !finished) fail(new Error(`阿里百炼实时语音识别连接提前关闭（code=${event.code}）：${event.reason}`));
      close();
    };
  });
}
