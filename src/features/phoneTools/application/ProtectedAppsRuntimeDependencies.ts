/** Protected Apps 只依赖用户集合读取契约，不拥有旧 CompanionSettings 持久化。 */

import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';

export interface ProtectedAppsRuntimeDependencies {
  loadUserProtectedPackages(): Promise<readonly string[]>;
}

const protectedAppsRuntimeSlot =
  createRuntimeSlot<ProtectedAppsRuntimeDependencies>('Protected Apps');

export function configureProtectedAppsRuntimeDependencies(
  dependencies: ProtectedAppsRuntimeDependencies,
): void {
  protectedAppsRuntimeSlot.configure(dependencies);
}

export function getProtectedAppsRuntimeDependencies(): ProtectedAppsRuntimeDependencies {
  return protectedAppsRuntimeSlot.get();
}
