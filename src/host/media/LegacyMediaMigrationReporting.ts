/** 正常 no-op 不制造启动日志；真实迁移或未解决引用才值得报告。 */
export function hasReportableLegacyMediaMigrationOutcome(
  migratedCount: number,
  unresolvedCount: number,
): boolean {
  return migratedCount > 0 || unresolvedCount > 0;
}
