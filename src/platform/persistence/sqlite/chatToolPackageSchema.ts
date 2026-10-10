/** 会话工具包的三轮暴露状态；不保存工具权限或工具参数。 */
export const CHAT_TOOL_PACKAGE_EXPOSURE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS chat_tool_package_exposure (
    session_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    assistant_id TEXT NOT NULL REFERENCES ai_assistants(id) ON DELETE CASCADE,
    package_id TEXT NOT NULL,
    remaining_turns INTEGER NOT NULL CHECK (remaining_turns BETWEEN 1 AND 3),
    PRIMARY KEY (session_id, assistant_id, package_id)
  );
`;
