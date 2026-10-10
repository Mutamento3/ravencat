/** 适配 RavenCat 原生模块中的 Companion 调度与运行状态能力。 */

import type { CompanionNativePort } from '../application/CompanionNativePort';
import {
  addCompanionExecutionCancelListener,
  addCompanionWakeListener,
  cancelAIScheduleTrigger,
  clearRavenCatNativeDataForFactoryReset,
  consumeCompanionExecutionCancellation,
  getNativeHealth,
  listAIScheduleTriggerProjections,
  recordCompanionRunnerCompletion,
  setCompanionSchedulingEnabled,
  scheduleAIScheduleTrigger,
} from '../../../../modules/ravencat-floating-layer';

export const companionNativeAdapter: CompanionNativePort = {
  addCompanionExecutionCancelListener,
  addCompanionWakeListener,
  cancelAIScheduleTrigger,
  clearCompanionNativeDataForFactoryReset: clearRavenCatNativeDataForFactoryReset,
  consumeExecutionCancellation: consumeCompanionExecutionCancellation,
  getNativeHealth,
  listAIScheduleTriggerProjections,
  recordRunnerCompletion: recordCompanionRunnerCompletion,
  setCompanionSchedulingEnabled,
  scheduleAIScheduleTrigger,
};
