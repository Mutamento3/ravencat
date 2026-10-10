/** 定义本地伴随稳定错误码、provider 分类与用户可见文案。 */

export type CompanionErrorCode =
  | 'host_ai_missing'
  | 'host_ai_blocked'
  | 'host_ai_model_unconfigured'
  | 'host_ai_session_missing'
  | 'host_ai_removed'
  | 'notification_permission_missing'
  | 'network_unavailable'
  | 'authentication_failed'
  | 'provider_busy'
  | 'request_timeout'
  | 'database_unavailable'
  | 'unknown_error';

const USER_MESSAGES: Record<CompanionErrorCode, string> = {
  host_ai_missing: '还没有设置主理 AI，请先选择一位主理 AI。',
  host_ai_blocked: '主理 AI 暂时无法使用，请先解除限制。',
  host_ai_model_unconfigured: '主理 AI 暂时无法使用，请检查模型配置。',
  host_ai_session_missing: '主理 AI 还没有可用的聊天会话，请先和它聊一聊。',
  host_ai_removed: '原主理 AI 已被删除，伴随模式已经关闭。',
  notification_permission_missing: '需要先允许通知提醒，才能开启伴随模式。',
  network_unavailable: '当前网络不可用，请连接网络后重试。',
  authentication_failed: '主理 AI 的认证信息不可用，请检查模型配置。',
  provider_busy: 'AI 服务现在有点忙，请稍后重试。',
  request_timeout: 'AI 响应超时，请稍后重试。',
  database_unavailable: '本地数据暂时不可用，请稍后重试。',
  unknown_error: '发生了暂时无法识别的问题，伴随模式没有开启。',
};
const COMPANION_ERROR_CODES = new Set<string>(Object.keys(USER_MESSAGES));

export class CompanionError extends Error {
  constructor(
    public readonly code: CompanionErrorCode,
    message?: string,
    public readonly cause?: unknown,
  ) {
    super(message || code);
    this.name = 'CompanionError';
  }
}

export function getCompanionErrorMessage(code: CompanionErrorCode): string {
  return USER_MESSAGES[code];
}

export function resolveCompanionErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return COMPANION_ERROR_CODES.has(code)
    ? USER_MESSAGES[code as CompanionErrorCode]
    : '上次伴随运行失败，系统已经关闭伴随模式。';
}

export function normalizeCompanionErrorCode(code: string | null): CompanionErrorCode {
  return code && COMPANION_ERROR_CODES.has(code)
    ? code as CompanionErrorCode
    : 'unknown_error';
}

export function classifyCompanionProviderError(error: unknown): CompanionError {
  if (error instanceof CompanionError) return error;
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();
  if (/\b401\b|unauthori[sz]ed|invalid api key|authentication fail|认证失败|api key.*无效|api key.*过期/.test(normalized)) {
    return new CompanionError('authentication_failed', message, error);
  }
  if (/\b429\b|\b5\d\d\b|overload|service unavailable|too many requests|rate limit|provider busy|服务繁忙|触发.*限流/.test(normalized)) {
    return new CompanionError('provider_busy', message, error);
  }
  if (/timeout|timed out|aborterror|aborted|请求超时|响应超时/.test(normalized)) {
    return new CompanionError('request_timeout', message, error);
  }
  if (/network|fetch failed|failed to fetch|internet|offline|econn|dns|网络错误|网络不可用|无法连接/.test(normalized)) {
    return new CompanionError('network_unavailable', message, error);
  }
  return new CompanionError('unknown_error', message || undefined, error);
}
