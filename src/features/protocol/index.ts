/** 协议空间功能公共出口，包含界面、仓储契约、应用入口和 AI 工具。 */
export { ProtocolView } from './presentation';
export {
  deleteProtocol,
  listProtocolsByAI,
  PROTOCOL_MAX_LENGTH,
  saveProtocol,
} from './composition';
export {
  SQLiteProtocolRepository,
  protocolRepository,
} from './infrastructure/SQLiteProtocolRepository';
export { AddProtocolTool } from './aiTools/AddProtocolTool';
export { DeleteProtocolTool } from './aiTools/DeleteProtocolTool';
export { GetProtocolsTool } from './aiTools/GetProtocolsTool';
export { SearchProtocolsTool } from './aiTools/SearchProtocolsTool';
export { UpdateProtocolTool } from './aiTools/UpdateProtocolTool';
export type {
  CreateProtocolInput,
  IProtocolRepository,
  Protocol,
  UpdateProtocolInput,
} from './domain/ProtocolRepository';
