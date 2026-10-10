/**
 * 会话列表首屏加载结果信号。
 *
 * 语义：
 * - AI 列表与群聊列表首次查询成功，并提交 React 状态后标记 ready；
 * - 空列表也属于 ready；
 * - 任一首次查询失败时标记 failed；
 * - ready 或 failed 后状态不可再被覆盖；
 * - 只表示首屏列表可用，不要求会话详情或消息时间线已加载。
 */

type ConversationListSignalState =
  | 'idle'
  | 'pending'
  | 'ready'
  | 'failed';

let state: ConversationListSignalState = 'idle';
let readyPromise: Promise<void> | null = null;
let resolveReady: (() => void) | null = null;
let rejectReady: ((error: Error) => void) | null = null;

function normalizeError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(String(error));
}

function ensurePromise(): Promise<void> {
  if (state === 'ready') {
    return Promise.resolve();
  }

  if (state === 'failed') {
    return readyPromise as Promise<void>;
  }

  if (!readyPromise) {
    state = 'pending';

    readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
  }

  return readyPromise;
}

/** 标记会话列表首屏加载成功。 */
export function markConversationListReady(): void {
  if (state === 'ready' || state === 'failed') {
    return;
  }

  state = 'ready';

  if (resolveReady) {
    resolveReady();
  } else {
    readyPromise = Promise.resolve();
  }

  resolveReady = null;
  rejectReady = null;
}

/** 标记会话列表首屏加载失败。 */
export function markConversationListFailed(error: unknown): void {
  if (state === 'ready' || state === 'failed') {
    return;
  }

  const normalizedError = normalizeError(error);
  state = 'failed';

  if (rejectReady) {
    rejectReady(normalizedError);
  } else {
    readyPromise = Promise.reject(normalizedError);

    // 防止在 Host 开始等待前产生未处理的 rejection。
    void readyPromise.catch(() => undefined);
  }

  resolveReady = null;
  rejectReady = null;
}

/** 等待会话列表首屏加载结果。 */
export function waitForConversationListReady(): Promise<void> {
  return ensurePromise();
}

/** 仅供测试或真正的新冷启动重置。 */
export function resetConversationListReady(): void {
  state = 'idle';
  readyPromise = null;
  resolveReady = null;
  rejectReady = null;
}