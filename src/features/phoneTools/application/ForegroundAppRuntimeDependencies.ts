/** Phone Tools 只消费 Device Observer 已确认的前台应用身份事实。 */

import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';

export interface ForegroundAppWindowFact {
  packageName: string | null;
  detectionReliable: boolean;
}

export interface ForegroundAppRuntimeDependencies {
  getCurrentWindowState(): Promise<ForegroundAppWindowFact>;
}

const foregroundAppRuntimeSlot =
  createRuntimeSlot<ForegroundAppRuntimeDependencies>('Foreground App');

export function configureForegroundAppRuntimeDependencies(
  dependencies: ForegroundAppRuntimeDependencies,
): void {
  foregroundAppRuntimeSlot.configure(dependencies);
}

export function getForegroundAppRuntimeDependencies(): ForegroundAppRuntimeDependencies {
  return foregroundAppRuntimeSlot.get();
}
