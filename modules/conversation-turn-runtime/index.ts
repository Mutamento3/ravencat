/** 普通聊天 AI 回复执行宿主的本地原生模块出口。 */
export { startConversationTurnTask } from './src/ConversationTurnRuntimeModule';
export { startHostRelationshipReplyTask } from './src/ConversationTurnRuntimeModule';
export { waitForConversationExecutionStop, finishConversationExecution, getConversationExecutionRemainingTime } from './src/ConversationTurnRuntimeModule';
