/** Screen Observation 公共 API；统一暴露安全窗口策略、观察能力与 AI Tool。 */

export { ReadScreenAccessibilityTool } from './aiTools/ReadScreenAccessibilityTool';
export { ReadScreenOcrTool } from './aiTools/ReadScreenOcrTool';

export {
  captureScreenForCurrentWindow,
  releaseCapturedScreen,
  type CapturedScreen,
} from './application/ScreenCapture';
export {
  ScreenCaptureError,
  type ScreenCaptureFailureReason,
} from './application/ScreenCapturePolicy';
export {
  assertScreenObservationWindowAllowed,
  ScreenObservationPolicyError,
  type ScreenObservationPolicyFailureReason,
  type ScreenObservationWindowIdentity,
} from './application/ScreenObservationPolicy';
export {
  readAccessibilitySemanticsForCurrentWindow,
  type ScreenSemanticNode,
  type ScreenSemanticSnapshot,
} from './application/ScreenSemanticObservation';
export {
  ScreenSemanticObservationError,
  type ScreenSemanticObservationFailureReason,
} from './application/ScreenSemanticObservationPolicy';
