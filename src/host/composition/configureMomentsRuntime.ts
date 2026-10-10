/** Host 装配 Moments 的窄图片理解运行时。 */
import { configureMomentsMediaRuntime } from '@features/moments/composition';
import { executeMomentImageAnalysis } from './MomentImageAnalysisModelGateway';

export function configureMomentsRuntime(): void {
  configureMomentsMediaRuntime(executeMomentImageAnalysis);
}
