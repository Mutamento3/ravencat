/**
 * @fileoverview AI 错误解析与展示映射
 *
 * 将 AI 接口层的错误识别逻辑集中到单一文件，避免
 * infrastructure 与 presentation 中出现重复的参数错误判断。
 *
 * @module platform/ai/errorMapping
 */

import type { ParamErrorInfo, QuotaErrorInfo, ServiceBusyErrorInfo, ErrorDisplayInfo } from './types';

/**
 * 检测错误是否为参数相关错误（temperature/topP/maxTokens）
 * @param message - 错误消息
 * @returns 参数错误信息
 */
export function detectParamError(message: string): ParamErrorInfo {
  const rawMessage = typeof message === 'string' ? message : String(message || '');
  const lowerMsg = rawMessage.toLowerCase();

  if (
    lowerMsg.includes('invalid temperature') ||
    lowerMsg.includes('temperature is not supported') ||
    lowerMsg.includes('temperature must be') ||
    (lowerMsg.includes('only') && lowerMsg.includes('is allowed') && lowerMsg.includes('temperature')) ||
    (lowerMsg.includes('temperature') && lowerMsg.includes('only') && lowerMsg.includes('allowed'))
  ) {
    const allowedMatch = rawMessage.match(/only ([\d.]+) is allowed/i) ||
      rawMessage.match(/must be ([\d.]+)/i);
    return {
      isParamError: true,
      paramName: 'temperature',
      allowedValue: allowedMatch ? allowedMatch[1] : null,
      message: allowedMatch
        ? `该模型只支持 Temperature = ${allowedMatch[1]}`
        : '该模型不支持当前 Temperature 设置',
    };
  }

  if (
    lowerMsg.includes('invalid top_p') ||
    lowerMsg.includes('top_p is not supported') ||
    lowerMsg.includes('top_p must be') ||
    lowerMsg.includes('topp is not supported') ||
    lowerMsg.includes('top p is not supported') ||
    (lowerMsg.includes('only') && lowerMsg.includes('is allowed') && lowerMsg.includes('top'))
  ) {
    const allowedMatch = rawMessage.match(/only ([\d.]+) is allowed/i) ||
      rawMessage.match(/must be ([\d.]+)/i);
    return {
      isParamError: true,
      paramName: 'topP',
      allowedValue: allowedMatch ? allowedMatch[1] : null,
      message: allowedMatch
        ? `该模型只支持 Top P = ${allowedMatch[1]}`
        : '该模型不支持当前 Top P 设置',
    };
  }

  if (
    lowerMsg.includes('invalid max_tokens') ||
    lowerMsg.includes('max_tokens is not supported') ||
    lowerMsg.includes('max_tokens must be')
  ) {
    return {
      isParamError: true,
      paramName: 'maxTokens',
      allowedValue: null,
      message: '该模型不支持当前 Max Tokens 设置',
    };
  }

  if (
    lowerMsg.includes('is not supported') ||
    lowerMsg.includes('unsupported parameter')
  ) {
    return {
      isParamError: true,
      paramName: 'parameter',
      allowedValue: null,
      message: '当前参数设置不被该模型支持',
    };
  }

  return {
    isParamError: false,
    paramName: null,
    allowedValue: null,
    message: '',
  };
}

/**
 * 检测错误是否为余额/配额不足
 * @param message - 错误消息
 * @returns 配额错误信息
 */
export function detectQuotaError(message: string): QuotaErrorInfo {
  const rawMessage = typeof message === 'string' ? message : String(message || '');
  const lowerMsg = rawMessage.toLowerCase();

  if (
    rawMessage.includes('402')
    || lowerMsg.includes('insufficient balance')
    || lowerMsg.includes('balance is insufficient')
    || lowerMsg.includes('insufficient_quota')
    || lowerMsg.includes('quota exceeded')
    || lowerMsg.includes('quota_exceeded')
    || lowerMsg.includes('billing')
    || lowerMsg.includes('credit balance')
    || lowerMsg.includes('payment required')
    || rawMessage.includes('余额不足')
  ) {
    return {
      isQuotaError: true,
      message: '账户余额或 API 配额不足，请充值、检查套餐权限，或更换可用的 API Key。',
    };
  }

  return {
    isQuotaError: false,
    message: '',
  };
}

/**
 * 检测错误是否为服务繁忙/限流
 * @param message - 错误消息
 * @returns 服务繁忙错误信息
 */
export function detectServiceBusyError(message: string): ServiceBusyErrorInfo {
  const rawMessage = typeof message === 'string' ? message : String(message || '');
  const lowerMsg = rawMessage.toLowerCase();

  if (
    rawMessage.includes('429')
    || lowerMsg.includes('overloaded')
    || lowerMsg.includes('engine is currently overloaded')
    || lowerMsg.includes('server is busy')
    || lowerMsg.includes('service unavailable')
    || lowerMsg.includes('too many requests')
    || lowerMsg.includes('rate limit')
    || lowerMsg.includes('try again later')
  ) {
    return {
      isServiceBusyError: true,
      message: '模型服务当前繁忙或触发了限流，请稍后再试。',
    };
  }

  return {
    isServiceBusyError: false,
    message: '',
  };
}

/**
 * 获取错误显示信息
 * @param error - 错误对象或消息
 * @returns 错误显示信息
 */
export function getErrorDisplayInfo(error: Error | string): ErrorDisplayInfo {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalizedMessage = message.toLowerCase();
  const paramErrorInfo = detectParamError(message);
  const quotaErrorInfo = detectQuotaError(message);
  const serviceBusyErrorInfo = detectServiceBusyError(message);

  if (paramErrorInfo.isParamError) {
    const paramDisplayName = paramErrorInfo.paramName === 'topP'
      ? 'Top P'
      : paramErrorInfo.paramName === 'temperature'
        ? 'Temperature'
        : paramErrorInfo.paramName === 'maxTokens'
          ? 'Max Tokens'
          : '参数';
    const allowedText = paramErrorInfo.allowedValue
      ? `该模型只允许设置为 ${paramErrorInfo.allowedValue}`
      : '该模型不支持此参数设置';

    return {
      title: '模型参数错误',
      message: `当前 ${paramDisplayName} 设置不被该模型支持。${allowedText}，请在 AI 设置中调整。`,
      type: 'param',
      isParamError: true,
      paramName: paramErrorInfo.paramName,
      allowedValue: paramErrorInfo.allowedValue,
    };
  }

  if (quotaErrorInfo.isQuotaError) {
    return {
      title: '余额或配额不足',
      message: quotaErrorInfo.message,
      type: 'quota',
    };
  }

  if (serviceBusyErrorInfo.isServiceBusyError) {
    return {
      title: '服务繁忙',
      message: serviceBusyErrorInfo.message,
      type: 'service_busy',
    };
  }

  if (
    message.includes('401') ||
    message.includes('2049') ||
    message.includes('Unauthorized') ||
    normalizedMessage.includes('authentication fails') ||
    normalizedMessage.includes('authentication failed') ||
    normalizedMessage.includes('api key') && normalizedMessage.includes('invalid') ||
    normalizedMessage.includes('invalid api key')
  ) {
    return {
      title: '认证失败',
      message: 'API Key 无效或已过期，请检查您的 API Key',
      type: 'auth',
    };
  }

  if (message.includes('403') || message.includes('Forbidden')) {
    return {
      title: '权限不足',
      message: '没有权限访问该 API，请检查您的账户权限',
      type: 'permission',
    };
  }

  if (message.includes('404') || message.includes('Not Found')) {
    return {
      title: '服务未找到',
      message: 'API 地址错误或该服务暂不可用',
      type: 'not_found',
    };
  }

  if (message.includes('Network') || message.includes('fetch')) {
    return {
      title: '网络错误',
      message: '无法连接到服务器，请检查网络或 API 地址',
      type: 'network',
    };
  }

  if (message.includes('timeout') || message.includes('Timeout')) {
    return {
      title: '请求超时',
      message: '服务器响应超时，请稍后重试',
      type: 'timeout',
    };
  }

  return {
    title: '请求失败',
    message: message || '未知错误',
    type: 'request',
  };
}
