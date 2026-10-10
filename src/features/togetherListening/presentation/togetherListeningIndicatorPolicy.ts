export type TogetherListeningIndicatorDisplayMode =
  | 'expanded'
  | 'collapsed_left'
  | 'collapsed_right';

export const TOGETHER_LISTENING_COLLAPSE_THRESHOLD = 56;
export const TOGETHER_LISTENING_COLLAPSE_VELOCITY = 700;

export function resolveIndicatorReleaseMode(input: {
  translationX: number;
  velocityX: number;
  threshold?: number;
  velocityThreshold?: number;
}): TogetherListeningIndicatorDisplayMode {
  const threshold = input.threshold ?? TOGETHER_LISTENING_COLLAPSE_THRESHOLD;
  const velocityThreshold = input.velocityThreshold ?? TOGETHER_LISTENING_COLLAPSE_VELOCITY;
  if (input.translationX <= -threshold || input.velocityX <= -velocityThreshold) {
    return 'collapsed_left';
  }
  if (input.translationX >= threshold || input.velocityX >= velocityThreshold) {
    return 'collapsed_right';
  }
  return 'expanded';
}

export interface CollapsedVerticalOffsetBounds {
  minOffset: number;
  maxOffset: number;
}

// collapsed chip 纵向拖动合法范围：容器 absolute + bottom: bottomOffset，
// translateY = 0 即默认位置，bottomOffset 继续作为下边界 authority（不允许
// 拖到默认位置以下，maxOffset = 0）；向上最多拖到 safe area top + topMargin。
export function resolveCollapsedVerticalOffsetBounds(input: {
  windowHeight: number;
  safeAreaTop: number;
  bottomOffset: number;
  chipHeight: number;
  topMargin: number;
}): CollapsedVerticalOffsetBounds {
  const defaultTop = input.windowHeight - input.bottomOffset - input.chipHeight;
  const highestTop = input.safeAreaTop + input.topMargin;
  return {
    // 几何异常（bottomOffset 过大 / 窗口过矮）时退化为只允许 0，不产生正区间。
    minOffset: Math.min(highestTop - defaultTop, 0),
    maxOffset: 0,
  };
}

export function clampCollapsedVerticalOffset(
  offset: number,
  bounds: CollapsedVerticalOffsetBounds,
): number {
  return Math.min(bounds.maxOffset, Math.max(bounds.minOffset, offset));
}
