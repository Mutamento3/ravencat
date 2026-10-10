export type ScreenSemanticObservationFailureReason =
  | 'accessibility_disabled'
  | 'accessibility_disconnected'
  | 'window_unavailable'
  | 'window_changed'
  | 'protected_app'
  | 'semantic_read_failed';

export class ScreenSemanticObservationError extends Error {
  readonly reason: ScreenSemanticObservationFailureReason;

  constructor(
    reason: ScreenSemanticObservationFailureReason,
    message: string,
  ) {
    super(message);
    this.reason = reason;
    this.name = 'ScreenSemanticObservationError';
  }
}
