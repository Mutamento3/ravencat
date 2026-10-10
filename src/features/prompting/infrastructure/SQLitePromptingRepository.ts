/** 使用 SQLite 持久化用户提示词片段、预设条目与目标绑定。 */

import { databaseCoordinator, type CoordinatedDatabaseExecutor } from '@platform/persistence';
import type {
  PromptBindingRepository,
  PromptCustomBlockRepository,
  PromptPresetRepository,
  AssistantPromptConfigurationRepository,
} from '../domain/PromptingRepositories';
import type {
  PromptBinding,
  PromptBindingTargetType,
  PromptCustomBlock,
  PromptPreset,
  PromptPresetItem,
  AssistantPromptSettings,
  AssistantPromptDefinitionState,
  AssistantPromptDefinitionOverride,
  AssistantUserPrompt,
  PromptMigrationOrphan,
  PromptLanguageMode,
} from '../domain/Prompting';
import type { PromptScenarioId } from '@shared/prompt';

type CustomBlockRow = {
  id: string; name: string; description: string | null; content: string;
  category: PromptCustomBlock['category']; default_slot: PromptCustomBlock['defaultSlot'];
  placement: 'system'; created_at: string; updated_at: string;
};
type PresetRow = {
  id: string; name: string; description: string | null; scenario_id: PromptScenarioId;
  base_preset_id: string | null; token_budget: number | null; is_system: number;
  created_at: string; updated_at: string;
};
type PresetItemRow = {
  id: string; preset_id: string; definition_id: string; slot: PromptPresetItem['slot'];
  sort_order: number; enabled: number; condition_json: string | null;
  created_at: string; updated_at: string;
};
type BindingRow = {
  id: string; scenario_id: PromptScenarioId; target_type: PromptBindingTargetType;
  target_id: string | null; preset_id: string; created_at: string; updated_at: string;
};
type AssistantPromptSettingsRow = {
  assistant_id: string; language_mode: PromptLanguageMode; created_at: string; updated_at: string;
};
type DefinitionStateRow = {
  assistant_id: string; definition_id: string; enabled: number; sort_order: number | null; updated_at: string;
};
type DefinitionOverrideRow = {
  assistant_id: string; definition_id: string; locale: 'zh-CN' | 'en-US'; content: string; updated_at: string;
};
type AssistantUserPromptRow = {
  id: string; assistant_id: string; name: string; content: string;
  condition: AssistantUserPrompt['condition']; enabled: number; sort_order: number;
  created_at: string; updated_at: string;
};
type MigrationOrphanRow = {
  id: string; source_type: PromptMigrationOrphan['sourceType']; source_id: string; reason: string; created_at: string;
};

export class SQLitePromptingRepository implements
  PromptCustomBlockRepository,
  PromptPresetRepository,
  PromptBindingRepository,
  AssistantPromptConfigurationRepository {
  async listDirectToolNames(assistantId: string): Promise<string[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.listDirectToolNames', feature: 'prompting', priority: 'runtime' });
    const rows = await db.getAllAsync<{ tool_name: string }>(
      'SELECT tool_name FROM assistant_direct_tools WHERE assistant_id = ? ORDER BY tool_name',
      [assistantId]
    );
    return rows.map((row) => row.tool_name);
  }

  async setDirectToolExposure(assistantId: string, toolName: string, exposed: boolean): Promise<void> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.setDirectToolExposure', feature: 'prompting', priority: 'runtime' });
    await db.runAsync(
      exposed
        ? 'INSERT OR IGNORE INTO assistant_direct_tools (assistant_id, tool_name) VALUES (?, ?)'
        : 'DELETE FROM assistant_direct_tools WHERE assistant_id = ? AND tool_name = ?',
      [assistantId, toolName]
    );
  }

  async listCustomBlocks(): Promise<PromptCustomBlock[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.listCustomBlocks', feature: 'prompting', priority: 'runtime' });
    const rows = await db.getAllAsync<CustomBlockRow>(
      'SELECT * FROM prompt_custom_blocks ORDER BY updated_at DESC'
    );
    return rows.map(mapCustomBlock);
  }

  async listPresets(scenarioId?: PromptScenarioId): Promise<PromptPreset[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.listPresets', feature: 'prompting', priority: 'runtime' });
    const rows = scenarioId
      ? await db.getAllAsync<PresetRow>(
          'SELECT * FROM prompt_presets WHERE scenario_id = ? ORDER BY updated_at DESC',
          [scenarioId]
        )
      : await db.getAllAsync<PresetRow>('SELECT * FROM prompt_presets ORDER BY updated_at DESC');
    return rows.map(mapPreset);
  }

  async getCustomBlockById(id: string): Promise<PromptCustomBlock | null> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.getCustomBlockById', feature: 'prompting', priority: 'runtime' });
    const row = await db.getFirstAsync<CustomBlockRow>(
      'SELECT * FROM prompt_custom_blocks WHERE id = ?', [id]
    );
    return row ? mapCustomBlock(row) : null;
  }

  async getPresetById(id: string): Promise<PromptPreset | null> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.getPresetById', feature: 'prompting', priority: 'runtime' });
    const row = await db.getFirstAsync<PresetRow>(
      'SELECT * FROM prompt_presets WHERE id = ?', [id]
    );
    return row ? mapPreset(row) : null;
  }

  async saveCustomBlock(block: PromptCustomBlock): Promise<PromptCustomBlock> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.saveCustomBlock', feature: 'prompting', priority: 'runtime' });
    await db.runAsync(
      `INSERT INTO prompt_custom_blocks (
         id, name, description, content, category, default_slot, placement, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, description = excluded.description, content = excluded.content,
         category = excluded.category, default_slot = excluded.default_slot,
         placement = excluded.placement, updated_at = excluded.updated_at`,
      [block.id, block.name, block.description, block.content, block.category,
        block.defaultSlot, block.placement, block.createdAt, block.updatedAt]
    );
    return block;
  }

  async savePreset(preset: PromptPreset): Promise<PromptPreset> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.savePreset', feature: 'prompting', priority: 'runtime' });
    await db.runAsync(
      `INSERT INTO prompt_presets (
         id, name, description, scenario_id, base_preset_id, token_budget,
         is_system, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, description = excluded.description,
         scenario_id = excluded.scenario_id, base_preset_id = excluded.base_preset_id,
         token_budget = excluded.token_budget, is_system = excluded.is_system,
         updated_at = excluded.updated_at`,
      [preset.id, preset.name, preset.description, preset.scenarioId, preset.basePresetId,
        preset.tokenBudget, preset.isSystem ? 1 : 0, preset.createdAt, preset.updatedAt]
    );
    return preset;
  }

  async listItems(presetId: string): Promise<PromptPresetItem[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.listItems', feature: 'prompting', priority: 'runtime' });
    const rows = await db.getAllAsync<PresetItemRow>(
      'SELECT * FROM prompt_preset_items WHERE preset_id = ? ORDER BY sort_order, id',
      [presetId]
    );
    return rows.map(mapPresetItem);
  }

  async listItemsByDefinitionId(definitionId: string): Promise<PromptPresetItem[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.listItemsByDefinitionId', feature: 'prompting', priority: 'runtime' });
    const rows = await db.getAllAsync<PresetItemRow>(
      'SELECT * FROM prompt_preset_items WHERE definition_id = ? ORDER BY preset_id, sort_order',
      [definitionId]
    );
    return rows.map(mapPresetItem);
  }

  async replaceItems(presetId: string, items: PromptPresetItem[]): Promise<PromptPresetItem[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.replaceItems', feature: 'prompting', priority: 'runtime' });
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM prompt_preset_items WHERE preset_id = ?', [presetId]);
      for (const presetItem of items) {
        await transaction.runAsync(
          `INSERT INTO prompt_preset_items (
             id, preset_id, definition_id, slot, sort_order, enabled,
             condition_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [presetItem.id, presetId, presetItem.definitionId, presetItem.slot,
            presetItem.sortOrder, presetItem.enabled ? 1 : 0, presetItem.conditionJson,
            presetItem.createdAt, presetItem.updatedAt]
        );
      }
    });
    return items;
  }

  async deleteCustomBlock(id: string): Promise<boolean> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.deleteCustomBlock', feature: 'prompting', priority: 'runtime' });
    const result = await db.runAsync('DELETE FROM prompt_custom_blocks WHERE id = ?', [id]);
    return result.changes > 0;
  }

  async deletePreset(id: string): Promise<boolean> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.deletePreset', feature: 'prompting', priority: 'runtime' });
    const result = await db.runAsync('DELETE FROM prompt_presets WHERE id = ?', [id]);
    return result.changes > 0;
  }

  async listByPresetId(presetId: string): Promise<PromptBinding[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.listByPresetId', feature: 'prompting', priority: 'runtime' });
    const rows = await db.getAllAsync<BindingRow>(
      'SELECT * FROM prompt_bindings WHERE preset_id = ? ORDER BY updated_at DESC',
      [presetId]
    );
    return rows.map(mapBinding);
  }

  async find(
    scenarioId: PromptScenarioId,
    targetType: PromptBindingTargetType,
    targetId: string | null
  ): Promise<PromptBinding | null> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.find', feature: 'prompting', priority: 'runtime' });
    const row = await db.getFirstAsync<BindingRow>(
      `SELECT * FROM prompt_bindings
       WHERE scenario_id = ? AND target_type = ? AND COALESCE(target_id, '') = COALESCE(?, '')
       LIMIT 1`,
      [scenarioId, targetType, targetId]
    );
    return row ? mapBinding(row) : null;
  }

  async saveBinding(binding: PromptBinding): Promise<PromptBinding> {
    const db: CoordinatedDatabaseExecutor = databaseCoordinator.openTaskExecutor({ name: 'prompting.saveBinding', feature: 'prompting', priority: 'runtime' });
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `DELETE FROM prompt_bindings
         WHERE scenario_id = ? AND target_type = ? AND COALESCE(target_id, '') = COALESCE(?, '')`,
        [binding.scenarioId, binding.targetType, binding.targetId]
      );
      await transaction.runAsync(
        `INSERT INTO prompt_bindings (
           id, scenario_id, target_type, target_id, preset_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [binding.id, binding.scenarioId, binding.targetType, binding.targetId,
          binding.presetId, binding.createdAt, binding.updatedAt]
      );
    });
    return binding;
  }

  async deleteBinding(id: string): Promise<boolean> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.deleteBinding', feature: 'prompting', priority: 'runtime' });
    const result = await db.runAsync('DELETE FROM prompt_bindings WHERE id = ?', [id]);
    return result.changes > 0;
  }

  async getAssistantSettings(assistantId: string): Promise<AssistantPromptSettings | null> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.getAssistantSettings', feature: 'prompting', priority: 'runtime' });
    const row = await db.getFirstAsync<AssistantPromptSettingsRow>(
      'SELECT * FROM assistant_prompt_settings WHERE assistant_id = ?',
      [assistantId]
    );
    return row ? mapAssistantPromptSettings(row) : null;
  }

  async saveAssistantLanguageMode(
    assistantId: string,
    languageMode: PromptLanguageMode
  ): Promise<AssistantPromptSettings> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.saveAssistantLanguageMode', feature: 'prompting', priority: 'runtime' });
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO assistant_prompt_settings (assistant_id, language_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(assistant_id) DO UPDATE SET
         language_mode = excluded.language_mode, updated_at = excluded.updated_at`,
      [assistantId, languageMode, now, now]
    );
    return {
      assistantId,
      languageMode,
      createdAt: (await this.getAssistantSettings(assistantId))?.createdAt || now,
      updatedAt: now,
    };
  }

  async listDefinitionStates(assistantId: string): Promise<AssistantPromptDefinitionState[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.listDefinitionStates', feature: 'prompting', priority: 'runtime' });
    const rows = await db.getAllAsync<DefinitionStateRow>(
      'SELECT * FROM assistant_prompt_definition_states WHERE assistant_id = ? ORDER BY definition_id',
      [assistantId]
    );
    return rows.map(mapDefinitionState);
  }

  async saveDefinitionState(
    state: AssistantPromptDefinitionState
  ): Promise<AssistantPromptDefinitionState> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.saveDefinitionState', feature: 'prompting', priority: 'runtime' });
    await db.runAsync(
      `INSERT INTO assistant_prompt_definition_states (
         assistant_id, definition_id, enabled, sort_order, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(assistant_id, definition_id) DO UPDATE SET
         enabled = excluded.enabled, sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
      [state.assistantId, state.definitionId, state.enabled ? 1 : 0, state.sortOrder, state.updatedAt]
    );
    return state;
  }

  async listDefinitionOverrides(assistantId: string): Promise<AssistantPromptDefinitionOverride[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.listDefinitionOverrides', feature: 'prompting', priority: 'runtime' });
    const rows = await db.getAllAsync<DefinitionOverrideRow>(
      'SELECT * FROM assistant_prompt_definition_overrides WHERE assistant_id = ? ORDER BY definition_id, locale',
      [assistantId]
    );
    return rows.map(mapDefinitionOverride);
  }

  async saveDefinitionOverride(
    override: AssistantPromptDefinitionOverride
  ): Promise<AssistantPromptDefinitionOverride> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.saveDefinitionOverride', feature: 'prompting', priority: 'runtime' });
    await db.runAsync(
      `INSERT INTO assistant_prompt_definition_overrides (
         assistant_id, definition_id, locale, content, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(assistant_id, definition_id, locale) DO UPDATE SET
         content = excluded.content, updated_at = excluded.updated_at`,
      [override.assistantId, override.definitionId, override.locale, override.content, override.updatedAt]
    );
    return override;
  }

  async resetDefinitionOverride(
    assistantId: string,
    definitionId: string,
    locale: 'zh-CN' | 'en-US'
  ): Promise<boolean> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.resetDefinitionOverride', feature: 'prompting', priority: 'runtime' });
    const result = await db.runAsync(
      `DELETE FROM assistant_prompt_definition_overrides
       WHERE assistant_id = ? AND definition_id = ? AND locale = ?`,
      [assistantId, definitionId, locale]
    );
    return result.changes > 0;
  }

  async listAssistantUserPrompts(assistantId: string): Promise<AssistantUserPrompt[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.listAssistantUserPrompts', feature: 'prompting', priority: 'runtime' });
    const rows = await db.getAllAsync<AssistantUserPromptRow>(
      `SELECT * FROM assistant_user_prompts
       WHERE assistant_id = ? ORDER BY condition, sort_order, id`,
      [assistantId]
    );
    return rows.map(mapAssistantUserPrompt);
  }

  async saveAssistantUserPrompt(prompt: AssistantUserPrompt): Promise<AssistantUserPrompt> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.saveAssistantUserPrompt', feature: 'prompting', priority: 'runtime' });
    await saveAssistantUserPromptRow(db, prompt);
    return prompt;
  }

  async saveAssistantUserPrompts(prompts: AssistantUserPrompt[]): Promise<AssistantUserPrompt[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.saveAssistantUserPrompts', feature: 'prompting', priority: 'runtime' });
    await db.withExclusiveTransactionAsync(async (transaction) => {
      for (const prompt of prompts) {
        await saveAssistantUserPromptRow(transaction, prompt);
      }
    });
    return prompts;
  }

  async deleteAssistantUserPrompt(id: string, assistantId: string): Promise<boolean> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.deleteAssistantUserPrompt', feature: 'prompting', priority: 'runtime' });
    const result = await db.runAsync(
      'DELETE FROM assistant_user_prompts WHERE id = ? AND assistant_id = ?',
      [id, assistantId]
    );
    return result.changes > 0;
  }

  async listMigrationOrphans(): Promise<PromptMigrationOrphan[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'prompting.listMigrationOrphans', feature: 'prompting', priority: 'runtime' });
    const rows = await db.getAllAsync<MigrationOrphanRow>(
      'SELECT * FROM prompt_migration_orphans ORDER BY created_at, id'
    );
    return rows.map(mapMigrationOrphan);
  }
}

function saveAssistantUserPromptRow(
  db: Pick<CoordinatedDatabaseExecutor, 'runAsync'>,
  prompt: AssistantUserPrompt
): Promise<unknown> {
  return db.runAsync(
    `INSERT INTO assistant_user_prompts (
       id, assistant_id, name, content, condition, enabled, sort_order, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, content = excluded.content, condition = excluded.condition,
       enabled = excluded.enabled, sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
    [prompt.id, prompt.assistantId, prompt.name, prompt.content, prompt.condition,
      prompt.enabled ? 1 : 0, prompt.sortOrder, prompt.createdAt, prompt.updatedAt]
  );
}

function mapCustomBlock(row: CustomBlockRow): PromptCustomBlock {
  return { id: row.id, name: row.name, description: row.description, content: row.content,
    category: row.category, defaultSlot: row.default_slot, placement: row.placement,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapPreset(row: PresetRow): PromptPreset {
  return { id: row.id, name: row.name, description: row.description, scenarioId: row.scenario_id,
    basePresetId: row.base_preset_id, tokenBudget: row.token_budget, isSystem: row.is_system === 1,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapPresetItem(row: PresetItemRow): PromptPresetItem {
  return { id: row.id, presetId: row.preset_id, definitionId: row.definition_id, slot: row.slot,
    sortOrder: row.sort_order, enabled: row.enabled === 1, conditionJson: row.condition_json,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapBinding(row: BindingRow): PromptBinding {
  return { id: row.id, scenarioId: row.scenario_id, targetType: row.target_type,
    targetId: row.target_id, presetId: row.preset_id, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapAssistantPromptSettings(row: AssistantPromptSettingsRow): AssistantPromptSettings {
  return { assistantId: row.assistant_id, languageMode: row.language_mode,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapDefinitionState(row: DefinitionStateRow): AssistantPromptDefinitionState {
  return { assistantId: row.assistant_id, definitionId: row.definition_id,
    enabled: row.enabled === 1, sortOrder: row.sort_order, updatedAt: row.updated_at };
}
function mapDefinitionOverride(row: DefinitionOverrideRow): AssistantPromptDefinitionOverride {
  return { assistantId: row.assistant_id, definitionId: row.definition_id, locale: row.locale,
    content: row.content, updatedAt: row.updated_at };
}
function mapAssistantUserPrompt(row: AssistantUserPromptRow): AssistantUserPrompt {
  return { id: row.id, assistantId: row.assistant_id, name: row.name, content: row.content,
    condition: row.condition, enabled: row.enabled === 1, sortOrder: row.sort_order,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapMigrationOrphan(row: MigrationOrphanRow): PromptMigrationOrphan {
  return { id: row.id, sourceType: row.source_type, sourceId: row.source_id,
    reason: row.reason, createdAt: row.created_at };
}

export const sqlitePromptingRepository = new SQLitePromptingRepository();
