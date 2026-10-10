import {
  SCREEN_CAPTURE_FAILURE_REASONS,
} from './ScreenCapturePolicy';

/** 截图准入与冻结失败原因直接复用截图唯一真值，OCR 只补充自己引入的原因。 */
export const SCREEN_OCR_OBSERVATION_FAILURE_REASONS = [
  ...SCREEN_CAPTURE_FAILURE_REASONS,
  'invalid_ocr_input',
  'ocr_failed',
  'snapshot_release_failed',
] as const;

export type ScreenOcrObservationFailureReason =
  (typeof SCREEN_OCR_OBSERVATION_FAILURE_REASONS)[number];

export class ScreenOcrObservationError extends Error {
  readonly reason: ScreenOcrObservationFailureReason;

  constructor(
    reason: ScreenOcrObservationFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.reason = reason;
    this.name = 'ScreenOcrObservationError';
  }
}
