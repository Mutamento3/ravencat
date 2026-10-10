/** 全局默认提示词的 SQL 只属于 Prompting，排序交换在同一事务提交。 */
import { databaseCoordinator } from '@platform/persistence';
import type { PromptDefaults, PromptDefaultsRepository } from '../domain/PromptDefaults';

function executor(name: string) {
  return databaseCoordinator.openTaskExecutor({ name: `prompting.defaults.${name}`, feature: 'prompting', priority: 'runtime' });
}

export const sqlitePromptDefaultsRepository: PromptDefaultsRepository = {
  async read(): Promise<PromptDefaults> {
    return executor('read').withExclusiveTransactionAsync(async (db) => {
      const overrides = await db.getAllAsync<{ definition_id: string; content: string }>('SELECT * FROM prompt_default_overrides');
      const switches = await db.getAllAsync<{ key: string; enabled: number }>('SELECT * FROM prompt_default_switches');
      const prompts = await db.getAllAsync<{ id: string; name: string; content: string; enabled: number; sort_order: number }>(
        'SELECT * FROM prompt_default_user_prompts ORDER BY sort_order, id',
      );
      return {
        overrides: Object.fromEntries(overrides.map((row) => [row.definition_id, row.content])),
        toolPermissions: Object.fromEntries(switches.filter((row) => row.key.startsWith('tool:')).map((row) => [row.key.slice(5), row.enabled === 1])),
        userPrompts: prompts.map((row) => ({ id: row.id, name: row.name, content: row.content, enabled: row.enabled === 1, sortOrder: row.sort_order })),
      };
    });
  },
  async saveOverride(definitionId, content) {
    await executor('saveOverride').runAsync(
      'INSERT INTO prompt_default_overrides (definition_id, content) VALUES (?, ?) ON CONFLICT(definition_id) DO UPDATE SET content = excluded.content',
      [definitionId, content],
    );
  },
  async resetOverride(definitionId) {
    await executor('resetOverride').runAsync('DELETE FROM prompt_default_overrides WHERE definition_id = ?', [definitionId]);
  },
  async saveUserPrompt(prompt) {
    await executor('saveUserPrompt').runAsync(
      `INSERT INTO prompt_default_user_prompts (id, name, content, enabled, sort_order) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, content = excluded.content, enabled = excluded.enabled, sort_order = excluded.sort_order`,
      [prompt.id, prompt.name, prompt.content, prompt.enabled ? 1 : 0, prompt.sortOrder],
    );
  },
  async deleteUserPrompt(id) {
    await executor('deleteUserPrompt').runAsync('DELETE FROM prompt_default_user_prompts WHERE id = ?', [id]);
  },
  async reorderUserPrompts(first, second) {
    await executor('reorderUserPrompts').withExclusiveTransactionAsync(async (db) => {
      await db.runAsync('UPDATE prompt_default_user_prompts SET sort_order = ? WHERE id = ?', [second.sortOrder, first.id]);
      await db.runAsync('UPDATE prompt_default_user_prompts SET sort_order = ? WHERE id = ?', [first.sortOrder, second.id]);
    });
  },
  async setEnabled(key, enabled) {
    await executor('setEnabled').runAsync(
      'INSERT INTO prompt_default_switches (key, enabled) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled',
      [key, enabled ? 1 : 0],
    );
  },
};
