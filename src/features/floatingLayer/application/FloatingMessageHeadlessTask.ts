/** Android Headless JS 悬浮消息宿主；业务执行由 Host 注入，不在此处持有 Companion 决策。 */

import {
  getFloatingLayerRuntimeDependencies,
  type FloatingMessageTaskData,
} from './FloatingLayerRuntimeDependencies';

export function runFloatingMessageHeadlessTask(
  data: FloatingMessageTaskData,
): Promise<void> {
  return getFloatingLayerRuntimeDependencies().executeFloatingMessage(data);
}
