/** 当前窗口 OCR 视觉观察的安全 application contract。 */

import {
  recognizeDeviceObserverScreenshotText,
  type DeviceObserverOcrSnapshot,
} from '@features/deviceControl';
import {
  captureScreenForCurrentWindow,
  releaseCapturedScreen,
  type CapturedScreen,
} from './ScreenCapture';
import { ScreenCaptureError } from './ScreenCapturePolicy';
import {
  ScreenOcrObservationError,
  SCREEN_OCR_OBSERVATION_FAILURE_REASONS,
  type ScreenOcrObservationFailureReason,
} from './ScreenOcrObservationPolicy';

export const SCREEN_OCR_LIMITS = {
  maxBlocks: 256,
  maxLines: 512,
  maxLineCharacters: 2_000,
  maxTotalCharacters: 32_768,
} as const;

export interface ScreenOcrLine {
  text: string;
}

export interface ScreenOcrBlock {
  text: string;
  lines: ScreenOcrLine[];
}

/** 截图 URI 不进入观察快照：返回上层时临时截图已经被释放。 */
export interface ScreenOcrSnapshot {
  packageName: string;
  windowId: number;
  capturedAtEpochMs: number;
  width: number;
  height: number;
  plainText: string;
  blocks: ScreenOcrBlock[];
  truncated: boolean;
  truncation: {
    blockLimitReached: boolean;
    lineLimitReached: boolean;
    characterLimitReached: boolean;
  };
}

/**
 * 一次调用最多发起一次截图、一次 OCR。
 *
 * 冻结点是 `captureScreenForCurrentWindow()` 返回已经通过 screenshot capture fence 的截图：
 * 之后用户切到任何窗口都与本次 OCR 无关，需要最新内容时必须重新调用本 API。
 */
export async function readOcrForCurrentWindow(): Promise<ScreenOcrSnapshot> {
  const capture = await captureFrozenOcrWindow();

  // 只消费已经冻结的 screenshot：不重新读取当前窗口、不重新截图、不因空结果重试。
  let snapshot: ScreenOcrSnapshot | null = null;
  let observationFailure: ScreenOcrObservationError | null = null;
  try {
    const recognized = await recognizeDeviceObserverScreenshotText(
      capture.screenshot.uri,
    );
    snapshot = normalizeScreenOcrSnapshot(recognized, capture);
  } catch (error) {
    observationFailure = buildScreenOcrObservationError(error);
  }

  // 必须等 OCR 消费完 frozen input 后再释放；释放失败不静默吞掉，也不做 retry。
  let releaseFailure: unknown = null;
  try {
    await releaseCapturedScreen(capture);
  } catch (error) {
    releaseFailure = error;
  }

  if (observationFailure) {
    if (releaseFailure) {
      throw new ScreenOcrObservationError(
        observationFailure.reason,
        observationFailure.message,
        { cause: releaseFailure },
      );
    }
    throw observationFailure;
  }
  if (releaseFailure) {
    throw new ScreenOcrObservationError(
      'snapshot_release_failed',
      'OCR 临时截图未能按预期释放。',
      { cause: releaseFailure },
    );
  }
  return snapshot;
}

async function captureFrozenOcrWindow(): Promise<CapturedScreen> {
  try {
    return await captureScreenForCurrentWindow();
  } catch (error) {
    if (error instanceof ScreenCaptureError) {
      throw new ScreenOcrObservationError(error.reason, error.message);
    }
    throw new ScreenOcrObservationError(
      'capture_failed',
      error instanceof Error ? error.message : '屏幕 OCR 截图失败。',
    );
  }
}

/**
 * 把原生有界结果收敛成产品 contract；native 已发生的裁剪必须继续传播。
 *
 * 截图身份是内部不变量：native bridge 是外部边界，进入 snapshot 前硬校验，
 * 不满足时直接失败，不使用默认值或静默补齐。
 */
export function normalizeScreenOcrSnapshot(
  snapshot: DeviceObserverOcrSnapshot,
  capture: CapturedScreen,
): ScreenOcrSnapshot {
  if (!capture.screenshot.packageName || capture.screenshot.windowId === null) {
    throw new ScreenOcrObservationError(
      'capture_failed',
      '冻结截图缺少窗口身份，无法建立 OCR 快照。',
    );
  }

  const blocks: ScreenOcrBlock[] = [];
  let lineCount = 0;
  let totalCharacters = 0;
  let blockLimitReached = snapshot.truncation.blockLimitReached;
  let lineLimitReached = snapshot.truncation.lineLimitReached;
  let characterLimitReached = snapshot.truncation.characterLimitReached;

  for (const rawBlock of snapshot.blocks) {
    if (blocks.length >= SCREEN_OCR_LIMITS.maxBlocks) {
      blockLimitReached = true;
      break;
    }
    if (lineCount >= SCREEN_OCR_LIMITS.maxLines) {
      lineLimitReached = true;
      break;
    }
    const lines: ScreenOcrLine[] = [];
    for (const rawLine of rawBlock.lines) {
      if (lineCount >= SCREEN_OCR_LIMITS.maxLines) {
        lineLimitReached = true;
        break;
      }
      const remaining = SCREEN_OCR_LIMITS.maxTotalCharacters - totalCharacters;
      if (remaining <= 0) {
        characterLimitReached = true;
        break;
      }
      const fitted = fitLine(
        rawLine.text,
        Math.min(SCREEN_OCR_LIMITS.maxLineCharacters, remaining),
      );
      if (!fitted.text) continue;
      characterLimitReached ||= fitted.truncated;
      totalCharacters += fitted.text.length;
      lines.push({ text: fitted.text });
      lineCount += 1;
    }
    if (lines.length === 0) continue;
    blocks.push({
      text: lines.map((line) => line.text).join('\n'),
      lines,
    });
  }

  const truncation = {
    blockLimitReached,
    lineLimitReached,
    characterLimitReached,
  };
  return {
    packageName: capture.screenshot.packageName,
    windowId: capture.screenshot.windowId,
    capturedAtEpochMs: capture.screenshot.capturedAtEpochMs,
    width: capture.screenshot.width,
    height: capture.screenshot.height,
    plainText: blocks.map((block) => block.text).join('\n'),
    blocks,
    truncated: Object.values(truncation).some(Boolean),
    truncation,
  };
}

/** 只处理首尾空白与换行形式；行内空白可能本身有意义，不做压缩。 */
function fitLine(value: string, limit: number): { text: string; truncated: boolean } {
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return { text: '', truncated: false };
  const fitted = normalized.slice(0, limit);
  return { text: fitted, truncated: fitted.length < normalized.length };
}

function buildScreenOcrObservationError(error: unknown): ScreenOcrObservationError {
  if (error instanceof ScreenOcrObservationError) return error;
  const candidate = error && typeof error === 'object' && 'reason' in error
    ? String((error as { reason?: unknown }).reason || '')
    : '';
  const reason = SCREEN_OCR_OBSERVATION_FAILURE_REASONS.some((item) => item === candidate)
    ? candidate as ScreenOcrObservationFailureReason
    : 'ocr_failed';
  return new ScreenOcrObservationError(
    reason,
    error instanceof Error ? error.message : '本地 OCR 识别失败。',
  );
}
