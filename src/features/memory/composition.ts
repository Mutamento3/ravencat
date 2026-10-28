/** 仅供 Host 装配 Memory 持久化与外部模型端口。 */
export { configureMemoryRuntimeDependencies, getMemoryRuntimeDependencies, MemoryEmbeddingError } from './application/MemoryRuntimeDependencies';
export { prepareMemoryRecord } from './application/MemoryCommands';
export { MemoryInputError, MemoryNotFoundError } from './domain/Memory';
export { emitMemoryChanged } from './application/MemorySignals';
export { memoryRepository } from './infrastructure/SQLiteMemoryRepository';
export { memoryEntryRepository } from './infrastructure/SQLiteMemoryEntryRepository';
export { initializeMemoryEmbeddingModelInTransaction } from './infrastructure/SQLiteMemoryEntryRepository';
export { synchronizeMemoryEmbeddingModel, processNextMemoryEmbedding } from './application/MemoryEmbeddingWorker';
