/**
 * @fileoverview 时间格式化工具
 *
 * UI层专用的时间格式化函数
 */

const TIME_INTERVAL_MINUTES = 5; // 时间分隔间隔（分钟）

export function formatMessageTime(createdAt: string): string {
  if (!createdAt) return '';

  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const diffTime = today.getTime() - targetDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  // 当天消息：只显示时间
  if (diffDays === 0) {
    return timeStr;
  }

  // 昨天：显示"昨天 xx:xx"
  if (diffDays === 1) {
    return `昨天 ${timeStr}`;
  }

  // 本周内（7天内）：显示"周x xx:xx"
  if (diffDays < 7) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${weekdays[date.getDay()]} ${timeStr}`;
  }

  // 本年内的消息：显示 "MM月DD日 xx:xx"
  if (date.getFullYear() === now.getFullYear()) {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}月${day}日 ${timeStr}`;
  }

  // 跨年消息：显示 "YYYY年MM月DD日 xx:xx"
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}年${month}月${day}日 ${timeStr}`;
}

export function shouldShowTimeSeparator(currentTime: string, prevTime: string): boolean {
  if (!currentTime || !prevTime) return true;

  const current = new Date(currentTime);
  const prev = new Date(prevTime);

  if (isNaN(current.getTime()) || isNaN(prev.getTime())) return true;

  const diffMs = current.getTime() - prev.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  return diffMinutes >= TIME_INTERVAL_MINUTES;
}

export function formatChatTime(timeStr: string): string {
  if (!timeStr) return '';

  const date = new Date(timeStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    // 今天显示时间
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } else {
    // 其他日期显示月/日
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }
}
