/** Host 只组合各 owner 的事务写入；通知与派生任务必须留在 commit 后。 */
import type { DatabaseTransactionExecutor } from '@platform/persistence';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { AuxiliaryModelConfig } from '../domain/AuxiliaryModel';

export interface AuxiliaryModelInitialization {
  initializeModelSelections(transaction: DatabaseTransactionExecutor, model: AuxiliaryModelConfig): Promise<void>;
  initializeAssistantSelections(transaction: DatabaseTransactionExecutor, assistantId: string, models: AuxiliaryModelConfig[]): Promise<void>;
  modelSelectionsInitialized(model: AuxiliaryModelConfig): void;
}

const slot = createRuntimeSlot<AuxiliaryModelInitialization>('Auxiliary model initialization');
export function configureAuxiliaryModelInitialization(dependencies: AuxiliaryModelInitialization): void { slot.configure(dependencies); }
export function getAuxiliaryModelInitialization(): AuxiliaryModelInitialization { return slot.get(); }
