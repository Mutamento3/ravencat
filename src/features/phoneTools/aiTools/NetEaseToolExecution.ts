/** 网易云 Host-only child Tool 共用的执行边界。 */

import { runAsCurrentHostAuthority } from '@features/assistants';
import type { ToolContext, ToolExecuteResult } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import type {
  NetEasePublicPlaylist,
  NetEasePublicPlaylistCandidate,
  NetEaseSongCandidate,
  NetEaseSongLyrics,
} from '../application/NetEasePublicDataBackend';

export const NETEASE_SEARCH_DEFAULT_LIMIT = 10;
export const NETEASE_SEARCH_MAX_LIMIT = 100;
export const NETEASE_MODEL_OBSERVATION_MAX_CHARS = 12_000;

const STRUCTURED_RESULT_PREFIX = '\n结构化结果：';

export async function runNetEaseToolAsCurrentHost(
  context: ToolContext,
  capability: () => Promise<ToolExecuteResult>,
): Promise<ToolExecuteResult> {
  const actorAiId = context.getAIId();
  if (!actorAiId) {
    return {
      success: false,
      error: 'missing_actor_ai_id: 未识别到当前 AI 身份',
      errorCode: 'missing_actor_ai_id',
    };
  }

  const authorityResult = await runAsCurrentHostAuthority(actorAiId, async () => {
    throwIfAbortSignalAborted(context.abortSignal);
    return capability();
  });

  if (authorityResult.status === 'not_current_host') {
    return {
      success: false,
      error: 'not_current_host: 当前 AI 已不再是主理 AI',
      errorCode: 'not_current_host',
    };
  }

  return authorityResult.value;
}

export function netEaseToolFailure(error: {
  code: string;
  message: string;
}): ToolExecuteResult {
  return {
    success: false,
    error: `${error.code}: ${error.message}`,
    errorCode: error.code,
  };
}

/** 小结果保持完整；若内部 contract 意外突破局部上限，应暴露契约错误。 */
export function netEaseToolSuccess(
  summary: string,
  data: unknown,
): ToolExecuteResult {
  return netEaseToolSuccessWithProjection(summary, data, data);
}

/** 搜索结果按完整候选逐项纳入，绝不截断单项 JSON 或丢失已保留候选的 identity。 */
export function netEaseSongCandidatesSuccess(
  summary: string,
  data: NetEaseSongCandidate[],
): ToolExecuteResult {
  return netEaseToolSuccessWithBoundedItems(summary, data, data, 'candidates');
}

export function netEasePlaylistCandidatesSuccess(
  summary: string,
  data: NetEasePublicPlaylistCandidate[],
): ToolExecuteResult {
  return netEaseToolSuccessWithBoundedItems(summary, data, data, 'candidates');
}

/** 歌单分页真值始终完整可见，tracks 只按完整歌曲项裁剪。 */
export function netEasePublicPlaylistSuccess(
  summary: string,
  data: NetEasePublicPlaylist,
): ToolExecuteResult {
  const { tracks, ...page } = data;
  return netEaseToolSuccessWithBoundedItems(summary, data, tracks, 'tracks', page);
}

/** 歌词用合法 JSON 投影，分别保留 backend 与 model observation 的截断真值。 */
export function netEaseSongLyricsSuccess(
  summary: string,
  data: NetEaseSongLyrics,
): ToolExecuteResult {
  if (data.status !== 'available') {
    return netEaseToolSuccess(summary, data);
  }

  const projectionFor = (text: string) => ({
    status: data.status,
    text,
    truncated: data.truncated,
    observationTruncated: text.length < data.text.length,
  });
  let low = 0;
  let high = data.text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fitsObservation(summary, projectionFor(data.text.slice(0, middle)))) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return netEaseToolSuccessWithProjection(summary, data, projectionFor(data.text.slice(0, low)));
}

function netEaseToolSuccessWithBoundedItems<T>(
  summary: string,
  data: unknown,
  items: readonly T[],
  itemsKey: 'candidates' | 'tracks',
  metadata: Record<string, unknown> = {},
): ToolExecuteResult {
  const retained: T[] = [];
  for (const item of items) {
    const candidate = {
      ...metadata,
      totalResultCount: items.length,
      retainedResultCount: retained.length + 1,
      observationTruncated: retained.length + 1 < items.length,
      [itemsKey]: [...retained, item],
    };
    if (!fitsObservation(summary, candidate)) break;
    retained.push(item);
  }
  const projection = {
    ...metadata,
    totalResultCount: items.length,
    retainedResultCount: retained.length,
    observationTruncated: retained.length < items.length,
    [itemsKey]: retained,
  };
  return netEaseToolSuccessWithProjection(summary, data, projection);
}

function netEaseToolSuccessWithProjection(
  summary: string,
  data: unknown,
  projection: unknown,
): ToolExecuteResult {
  const message = `${summary}${STRUCTURED_RESULT_PREFIX}${JSON.stringify(projection)}`;
  if (message.length > NETEASE_MODEL_OBSERVATION_MAX_CHARS) {
    throw new Error('NetEase model observation 超出局部上限');
  }
  return {
    success: true,
    message,
    data,
  };
}

function fitsObservation(summary: string, projection: unknown): boolean {
  return `${summary}${STRUCTURED_RESULT_PREFIX}${JSON.stringify(projection)}`.length
    <= NETEASE_MODEL_OBSERVATION_MAX_CHARS;
}
