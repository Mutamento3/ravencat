/** 设置的旧快照已失效；向调用者明确报告冲突，不自动覆盖或重试。 */
export class SettingChangeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingChangeConflictError';
  }
}
