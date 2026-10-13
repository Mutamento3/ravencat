/** 辅助模型资产仓储的 SQLite 实现。 */
import type {
  AuxiliaryModelConfig,
  CapabilityKind,
  CreateAuxiliaryModelConfigInput,
  UpdateAuxiliaryModelConfigInput,
} from '../domain/AuxiliaryModel';
import type { IAuxiliaryModelRepository } from '../domain/AuxiliaryModelRepository';
import { databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import { initializeAuxiliaryModelInTransaction } from './SQLiteAuxiliaryModelDefaults';
import { getAuxiliaryModelInitialization } from '../application/AuxiliaryModelInitialization';

interface AuxiliaryModelConfigRow {
  id: string;
  capability_kind: CapabilityKind;
  name: string;
  base_url: string;
  api_key: string | null;
  model: string;
  temperature: number | null;
  top_p: number | null;
  max_tokens: number | null;
  enabled: number;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

function buildRepositoryId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class AuxiliaryModelRepository implements IAuxiliaryModelRepository {
  async listModelConfigs(params: { capabilityKind?: CapabilityKind } = {}): Promise<AuxiliaryModelConfig[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'assistants.listModelConfigs', feature: 'assistants', priority: 'runtime' });
    // 历史退休资产不作为当前可运行能力进入模型中心。
    const whereParts: string[] = ["capability_kind IN ('general', 'embedding', 'ocr', 'stt', 'tts', 'translation')"];
    const values: string[] = [];

    if (params.capabilityKind) {
      whereParts.push('capability_kind = ?');
      values.push(params.capabilityKind);
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const rows = await db.getAllAsync<AuxiliaryModelConfigRow>(
      `SELECT * FROM auxiliary_model_configs ${whereClause} ORDER BY updated_at DESC`,
      values
    );
    return rows.map((row) => this.mapModelConfigRow(row));
  }

  async getModelConfigById(id: string): Promise<AuxiliaryModelConfig | null> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'assistants.getModelConfigById', feature: 'assistants', priority: 'runtime' });
    const row = await db.getFirstAsync<AuxiliaryModelConfigRow>(
      `SELECT * FROM auxiliary_model_configs WHERE id = ? LIMIT 1`,
      [id]
    );
    return row ? this.mapModelConfigRow(row) : null;
  }

  async insertModelConfig(input: CreateAuxiliaryModelConfigInput): Promise<AuxiliaryModelConfig> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'assistants.insertModelConfig', feature: 'assistants', priority: 'runtime' });
    const now = input.createdAt ?? new Date().toISOString();
    const id = buildRepositoryId('auxcfg');

    const { inserted, initialized } = await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO auxiliary_model_configs (
           id, capability_kind, name, base_url, api_key, model, temperature, top_p, max_tokens,
           enabled, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.capabilityKind,
          input.name,
          input.baseUrl,
          input.apiKey ?? null,
          input.model,
          input.temperature ?? null,
          input.topP ?? null,
          input.maxTokens ?? null,
          input.enabled === false ? 0 : 1,
          input.metadataJson ?? null,
          now,
          now,
        ]
      );

      const inserted = await this.getModelConfigByIdInTransaction(transaction, id);
      if (!inserted) {
        throw new Error('创建后的辅助模型配置不存在');
      }

      const initialized = await initializeAuxiliaryModelInTransaction(transaction, inserted);
      return { inserted, initialized };
    });
    if (initialized) getAuxiliaryModelInitialization().modelSelectionsInitialized(inserted);
    return inserted;
  }

  async getModelConfigByIdInTransaction(transaction: DatabaseTransactionExecutor, id: string): Promise<AuxiliaryModelConfig | null> {
    const row = await transaction.getFirstAsync<AuxiliaryModelConfigRow>('SELECT * FROM auxiliary_model_configs WHERE id = ?', [id]);
    return row ? this.mapModelConfigRow(row) : null;
  }

  async updateModelConfig(
    id: string,
    input: UpdateAuxiliaryModelConfigInput
  ): Promise<AuxiliaryModelConfig> {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (input.name !== undefined) {
      fields.push('name = ?');
      values.push(input.name);
    }
    if (input.capabilityKind !== undefined) {
      fields.push('capability_kind = ?');
      values.push(input.capabilityKind);
    }
    if (input.baseUrl !== undefined) {
      fields.push('base_url = ?');
      values.push(input.baseUrl);
    }
    if (input.apiKey !== undefined) {
      fields.push('api_key = ?');
      values.push(input.apiKey);
    }
    if (input.model !== undefined) {
      fields.push('model = ?');
      values.push(input.model);
    }
    if (input.temperature !== undefined) {
      fields.push('temperature = ?');
      values.push(input.temperature);
    }
    if (input.topP !== undefined) {
      fields.push('top_p = ?');
      values.push(input.topP);
    }
    if (input.maxTokens !== undefined) {
      fields.push('max_tokens = ?');
      values.push(input.maxTokens);
    }
    if (input.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(input.enabled ? 1 : 0);
    }
    if (input.metadataJson !== undefined) {
      fields.push('metadata_json = ?');
      values.push(input.metadataJson);
    }

    const now = new Date().toISOString();
    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    const db = databaseCoordinator.openTaskExecutor({ name: 'assistants.updateModelConfig', feature: 'assistants', priority: 'runtime' });
    // 增量写入与确认读取属于同一原子操作，不能返回另一笔编辑的投影。
    const { updated, initialized } = await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(`UPDATE auxiliary_model_configs SET ${fields.join(', ')} WHERE id = ?`, values);
      const row = await transaction.getFirstAsync<AuxiliaryModelConfigRow>(
        'SELECT * FROM auxiliary_model_configs WHERE id = ? LIMIT 1', [id],
      );
      if (!row) throw new Error(`辅助模型配置不存在：${id}`);
      const updated = this.mapModelConfigRow(row);
      const initialized = await initializeAuxiliaryModelInTransaction(transaction, updated);
      if (input.capabilityKind !== undefined || input.baseUrl !== undefined || input.apiKey !== undefined || input.model !== undefined
        || input.temperature !== undefined || input.topP !== undefined || input.maxTokens !== undefined || input.enabled !== undefined) {
        await getAuxiliaryModelInitialization().invalidateModelReferencesInTransaction(transaction, id);
      }
      return { updated, initialized };
    });
    if (initialized) getAuxiliaryModelInitialization().modelSelectionsInitialized(updated);
    return updated;
  }

  async deleteModelConfig(id: string): Promise<boolean> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'assistants.deleteModelConfig', feature: 'assistants', priority: 'runtime' });
    return db.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(`DELETE FROM auxiliary_model_configs WHERE id = ?`, [id]);
      if (result.changes > 0) await getAuxiliaryModelInitialization().invalidateModelReferencesInTransaction(transaction, id);
      return result.changes > 0;
    });
  }

  private mapModelConfigRow(row: AuxiliaryModelConfigRow): AuxiliaryModelConfig {
    return {
      id: row.id,
      capabilityKind: row.capability_kind,
      name: row.name,
      baseUrl: row.base_url,
      apiKey: row.api_key,
      model: row.model,
      temperature: row.temperature,
      topP: row.top_p,
      maxTokens: row.max_tokens,
      enabled: row.enabled === 1,
      metadataJson: row.metadata_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

}

export const auxiliaryModelRepository = new AuxiliaryModelRepository();
