/** 从唯一持久策略来源解析所有 Phone capability 共用的当前有效保护集合。 */

import { getEffectiveProtectedPackages } from './ProtectedAppsPolicy';
import { getProtectedAppsRuntimeDependencies } from './ProtectedAppsRuntimeDependencies';

export async function loadCurrentProtectedPackages(): Promise<string[]> {
  const userPackages = await getProtectedAppsRuntimeDependencies()
    .loadUserProtectedPackages();
  return getEffectiveProtectedPackages(userPackages);
}
