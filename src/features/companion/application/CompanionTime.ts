/** 为伴随决策输入和诊断日志生成带时区的本地可读时间。 */

export function formatCompanionLocalTime(
  value: string | Date,
  timeZone: string,
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) {
    throw new Error('RavenCat 本地时间格式化输入非法');
  }
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((item) => item.type === type);
    if (!found) throw new Error(`RavenCat 本地时间缺少 ${type}`);
    return found.value;
  };
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')} (${timeZone})`;
}
