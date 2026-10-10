/** 只允许仍挂载页面的最新读取结果提交到 presentation state。 */
export function canCommitPresentationLoad(
  mounted: boolean,
  latestRevision: number,
  completedRevision: number,
): boolean {
  return mounted && latestRevision === completedRevision;
}
