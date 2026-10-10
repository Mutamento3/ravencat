/** 执行通话占用、拉黑、模型配置和 Android 权限预检。 */

import { requestNotificationPermission } from '@platform/device';
import type { ICallRepository } from '../../domain/CallRepository';
import type { CallAIConfig } from '../../domain/CallAIConfig';
import type { CallDirection } from '../../domain/CallSession';
import type { CallPreflightOptions, CallPreflightResult } from './CallRuntimeTypes';
import { getCallRuntimeDependencies } from './CallRuntimeDependencies';

export async function runCallPreflight(
  callRepository: ICallRepository,
  aiConfig: CallAIConfig,
  direction: CallDirection,
  options: CallPreflightOptions
): Promise<CallPreflightResult> {
  if (await callRepository.getActiveSession()) {
    return { ok: false, errorMessage: '当前已有通话正在进行', endReason: 'busy' };
  }

  if (aiConfig.isBlocked) {
    return { ok: false, errorMessage: '该 AI 当前不可接通', endReason: 'blocked' };
  }

  if (!aiConfig.apiBaseUrl || !aiConfig.apiKey || !aiConfig.model) {
    return {
      ok: false,
      errorMessage: direction === 'outgoing' ? '对方暂时无法接通' : '来电链路未配置完整',
      endReason: 'preflightFailed',
    };
  }

  if (options.requiresNotification && !(await requestNotificationPermission())) {
    return {
      ok: false,
      errorMessage: '通知权限未开启，无法显示 AI 来电提示',
      endReason: 'permissionDenied',
    };
  }

  if (options.requiresCamera && !(await getCallRuntimeDependencies().native.requestCallCameraPermission()).granted) {
    return {
      ok: false,
      errorMessage: '相机权限未开启，无法启用视频画面',
      endReason: 'permissionDenied',
    };
  }

  return { ok: true, errorMessage: null, endReason: null };
}
