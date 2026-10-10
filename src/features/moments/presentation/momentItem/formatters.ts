export function formatTime(isoString: string): string {
  if (!isoString) return '';

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const currentYear = now.getFullYear();

  if (year === currentYear) {
    return `${month}月${day}日`;
  }
  return `${year}年${month}月${day}日`;
}

export function getLikesText(likes: { userName: string }[] = []): string {
  if (likes.length === 0) return '';
  return likes.map((l) => l.userName).join('，');
}
