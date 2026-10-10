/** 朋友圈实体 ID 生成：ID 由 trusted 调用方生成，模型与 UI 不能自行指定身份。 */

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 11);
}

export function createMomentId(now: number = Date.now()): string {
  return `moment_${now}_${randomSuffix()}`;
}

export function createMomentCommentId(now: number = Date.now()): string {
  return `comment_${now}_${randomSuffix()}`;
}

export function createMomentMediaId(now: number = Date.now()): string {
  return `moment_media_${now}_${randomSuffix()}`;
}
