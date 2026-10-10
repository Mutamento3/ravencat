/**
 * @fileoverview 消息时间分隔判定规则
 * 归属：Chat messages 领域层。
 *
 * 时间分隔的判定依赖"前一条消息"，必须与消息插入处于同一数据库事务内，
 * 避免事务外读取 latest message 造成并发竞争。
 */

/** 相邻两条消息间隔达到该毫秒数时，后一条消息前显示时间分隔。 */
export const TIME_SEPARATOR_GAP_MS = 10 * 60 * 1000;

/** 根据前一条消息的创建时间判断新消息前是否需要显示时间分隔。 */
export function shouldShowTimeSeparatorBefore(
  previousMessage: { createdAt: string } | null,
  createdAt: string,
): boolean {
  if (!previousMessage) {
    return true;
  }

  const previousTimestamp = new Date(previousMessage.createdAt).getTime();
  const currentTimestamp = new Date(createdAt).getTime();

  if (!Number.isFinite(previousTimestamp) || !Number.isFinite(currentTimestamp)) {
    return false;
  }

  return currentTimestamp - previousTimestamp >= TIME_SEPARATOR_GAP_MS;
}
