/** 唯一真值：OCR 等观察能力复用这份原因列表，避免再复制一份容易漂移的截图原因。 */
export const SCREEN_CAPTURE_FAILURE_REASONS = [
  'accessibility_disabled',
  'accessibility_disconnected',
  'screenshot_capability_missing',
  'window_changed',
  'window_unavailable',
  'protected_app',
  'secure_window',
  'capture_interval_too_short',
  'invalid_display',
  'invalid_window',
  'image_write_failed',
  'capture_failed',
] as const;

export type ScreenCaptureFailureReason =
  (typeof SCREEN_CAPTURE_FAILURE_REASONS)[number];

export class ScreenCaptureError extends Error {
  readonly reason: ScreenCaptureFailureReason;

  constructor(
    reason: ScreenCaptureFailureReason,
    message: string,
  ) {
    super(message);
    this.reason = reason;
    this.name = 'ScreenCaptureError';
  }
}
