/** Agent 执行、模型轮次与工具回执的当前持久化结构。 */

export const AGENT_RUNS_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_runs (
        run_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        source TEXT NOT NULL,
        assistant_id TEXT NOT NULL,
        session_id TEXT,
        resumable INTEGER NOT NULL CHECK (resumable IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'running', 'waiting_for_confirmation', 'waiting_for_foreground',
          'suspended', 'completed', 'failed', 'cancelled', 'expired'
        )),
        terminal_code TEXT,
        task_json TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        step_count INTEGER NOT NULL,
        tool_call_count INTEGER NOT NULL
      );
`;

export const AGENT_STEPS_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_steps (
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        model_turn_json TEXT NOT NULL,
        tool_call_count INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        PRIMARY KEY (run_id, step_index),
        FOREIGN KEY (run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
      );
`;

export const AGENT_TOOL_RECEIPTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_tool_receipts (
        receipt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        idempotency TEXT NOT NULL CHECK (idempotency IN ('idempotent', 'key_required', 'not_idempotent')),
        status TEXT NOT NULL CHECK (status IN (
          'prepared', 'executing', 'succeeded', 'failed', 'unknown_outcome'
        )),
        arguments_redacted TEXT NOT NULL,
        outcome_status TEXT,
        outcome_code TEXT,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE (run_id, step_index, tool_call_id),
        FOREIGN KEY (run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
      );
`;
