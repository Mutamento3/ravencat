/** 会话工具包持续展开的事实；行存在即展开，不保存工具权限或工具参数。 */
export const CHAT_TOOL_PACKAGE_EXPOSURE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS chat_tool_package_exposure (
    session_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    assistant_id TEXT NOT NULL REFERENCES ai_assistants(id) ON DELETE CASCADE,
    package_id TEXT NOT NULL,
    PRIMARY KEY (session_id, assistant_id, package_id)
  );
`;
