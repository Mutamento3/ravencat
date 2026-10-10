import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TogetherListeningIndicatorDisplayMode } from './togetherListeningIndicatorPolicy';

const STORAGE_KEY = 'togetherListening.inAppIndicator.position.v1';
let pendingWrite: Promise<void> = Promise.resolve();

export interface TogetherListeningIndicatorPosition {
  activityId: string;
  displayMode: TogetherListeningIndicatorDisplayMode;
  collapsedVerticalOffset: number;
}

function isDisplayMode(value: unknown): value is TogetherListeningIndicatorDisplayMode {
  return value === 'expanded' || value === 'collapsed_left' || value === 'collapsed_right';
}

function parsePosition(value: unknown): TogetherListeningIndicatorPosition | null {
  if (!value || typeof value !== 'object') return null;
  const position = value as Partial<TogetherListeningIndicatorPosition>;
  if (
    typeof position.activityId !== 'string'
    || !isDisplayMode(position.displayMode)
    || typeof position.collapsedVerticalOffset !== 'number'
    || !Number.isFinite(position.collapsedVerticalOffset)
  ) {
    return null;
  }
  return {
    activityId: position.activityId,
    displayMode: position.displayMode,
    collapsedVerticalOffset: position.collapsedVerticalOffset,
  };
}

/** 只恢复同一 Together Listening Activity 的 presentation 位置。 */
export async function loadTogetherListeningIndicatorPosition(
  activityId: string,
): Promise<TogetherListeningIndicatorPosition | null> {
  try {
    await pendingWrite;
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const position = parsePosition(JSON.parse(stored));
    return position?.activityId === activityId ? position : null;
  } catch {
    // AsyncStorage 是外部边界；损坏或读取失败时由当前 Activity 使用默认位置。
    return null;
  }
}

/** 写入失败不影响本次手势已经提交的内存态。 */
export async function saveTogetherListeningIndicatorPosition(
  position: TogetherListeningIndicatorPosition,
): Promise<void> {
  pendingWrite = pendingWrite
    .then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(position)))
    .catch(() => {
      // presentation 偏好持久化失败不应打断一起听交互。
    });
  await pendingWrite;
}
