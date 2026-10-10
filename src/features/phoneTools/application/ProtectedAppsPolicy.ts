/** Phone capability 共用的受保护应用真值与准入策略。 */

export const SYSTEM_PROTECTED_PACKAGES = [
  'com.android.settings',
  'com.android.permissioncontroller',
  'com.google.android.permissioncontroller',
] as const;

export type ProtectedAppsCapabilityKind = 'observation' | 'action';
export type ProtectedAppsPolicyFailureReason = 'protected_app';

export class ProtectedAppsPolicyError extends Error {
  readonly reason: ProtectedAppsPolicyFailureReason;

  constructor(message: string) {
    super(message);
    this.reason = 'protected_app';
    this.name = 'ProtectedAppsPolicyError';
  }
}

/** 合并固定系统保护集合与用户当前保存的受保护应用。 */
export function getEffectiveProtectedPackages(
  userPackages: readonly string[],
): string[] {
  return normalizeProtectedPackageList([
    ...SYSTEM_PROTECTED_PACKAGES,
    ...userPackages,
  ]);
}

/** 只保留用户可配置部分，避免把固定系统保护集合写回旧持久字段。 */
export function extractUserProtectedPackages(
  effectivePackages: readonly string[],
): string[] {
  const systemProtectedPackages = new Set<string>(SYSTEM_PROTECTED_PACKAGES);
  return normalizeProtectedPackageList(effectivePackages).filter(
    (packageName) => !systemProtectedPackages.has(packageName),
  );
}

export function isProtectedPackage(
  packageName: string,
  protectedPackages: readonly string[],
): boolean {
  const normalizedPackageName = normalizeProtectedPackageName(packageName);
  return protectedPackages.some(
    (protectedPackageName) => (
      normalizeProtectedPackageName(protectedPackageName) === normalizedPackageName
    ),
  );
}

/** 观察内容或新增设备影响前必须经过此本地边界；撤销已有影响不调用它。 */
export function assertProtectedAppCapabilityAllowed(
  packageName: string,
  protectedPackages: readonly string[],
  capabilityKind: ProtectedAppsCapabilityKind,
): void {
  if (!isProtectedPackage(packageName, protectedPackages)) {
    return;
  }

  throw new ProtectedAppsPolicyError(
    capabilityKind === 'observation'
      ? '该应用被用户设置为受保护应用，AI 无权查看。'
      : '该应用被用户设置为受保护应用，AI 无权对其执行此操作。',
  );
}

function normalizeProtectedPackageList(packages: readonly string[]): string[] {
  return [...new Set(
    packages
      .map(normalizeProtectedPackageName)
      .filter(Boolean),
  )].sort();
}

function normalizeProtectedPackageName(packageName: string): string {
  return packageName.trim().toLowerCase();
}
