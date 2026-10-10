/** Screen Capture 应用层公共出口。 */

export {
  captureScreenForCurrentWindow,
  releaseCapturedScreen,
  type CapturedScreen,
} from './ScreenCapture';
export {
  SCREEN_CAPTURE_FAILURE_REASONS,
  ScreenCaptureError,
  type ScreenCaptureFailureReason,
} from './ScreenCapturePolicy';
export {
  assertScreenObservationWindowAllowed,
  ScreenObservationPolicyError,
  type ScreenObservationPolicyFailureReason,
  type ScreenObservationWindowIdentity,
} from './ScreenObservationPolicy';
export {
  normalizeScreenSemanticSnapshot,
  readAccessibilitySemanticsForCurrentWindow,
  SCREEN_SEMANTIC_LIMITS,
  type ScreenSemanticNode,
  type ScreenSemanticSnapshot,
} from './ScreenSemanticObservation';
export {
  ScreenSemanticObservationError,
  type ScreenSemanticObservationFailureReason,
} from './ScreenSemanticObservationPolicy';
export {
  normalizeScreenOcrSnapshot,
  readOcrForCurrentWindow,
  SCREEN_OCR_LIMITS,
  type ScreenOcrBlock,
  type ScreenOcrLine,
  type ScreenOcrSnapshot,
} from './ScreenOcrObservation';
export {
  ScreenOcrObservationError,
  type ScreenOcrObservationFailureReason,
} from './ScreenOcrObservationPolicy';
