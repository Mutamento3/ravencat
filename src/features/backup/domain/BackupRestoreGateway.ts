export interface PreparedRestoreHandle {
  restoreId: string;
  createdAt: string;
  appVersion: string;
  stableSettingsJson: string;
  /** staging 中 bubble skin backing 的只读根，用于恢复替换前的 owner 校验。 */
  bubbleSkinRootUri: string;
  /** staging 中 persistent-media backing 的只读根，用于恢复替换前的媒体引用 preflight。 */
  mediaRootUri: string;
  /** 已校验完整性的 staging 数据库，用于 owner 的只读媒体引用 preflight。 */
  databaseUri: string;
}

export interface BackupRestoreGateway {
  prepare(
    artifactLocator: string,
    currentDatabaseContractVersion: number,
  ): Promise<PreparedRestoreHandle>;
  discard(restoreId: string): Promise<void>;
  activateAndExit(restoreId: string, rollbackStableSettingsJson: string): Promise<void>;
}
