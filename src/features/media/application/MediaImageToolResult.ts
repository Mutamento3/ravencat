import type { AgentToolExecutionResult } from '@shared/aiTools';
import { ImageFileReadError } from '@platform/device';
import { MediaAssetMissingError, MediaAssetNotFoundError } from './MediaAssetResolver';

/** 预期的文件边界失败转为可处理 observation；数据库和内部契约异常继续暴露。 */
export function mediaImageFailure(error: unknown): AgentToolExecutionResult<never> | null {
  if (error instanceof MediaAssetNotFoundError) return { status: 'error', code: 'IMAGE_NOT_FOUND', retryable: false, modelContent: '这个图片 ID 不存在，请使用消息或下载工具返回的有效图片 ID。' };
  if (error instanceof MediaAssetMissingError) return { status: 'error', code: 'IMAGE_MISSING', retryable: false, modelContent: '找不到这张图片的本地文件，请重新下载或请用户重新发送；本次操作未完成。' };
  if (error instanceof ImageFileReadError) return { status: 'error', code: 'IMAGE_UNREADABLE', retryable: false, modelContent: error.message };
  return null;
}
