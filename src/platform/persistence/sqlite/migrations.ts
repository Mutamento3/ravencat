import { migrateCompanionSchedules } from './companionScheduleMigration';
/** 按历史顺序执行 SQLite 版本迁移。 */

import type { DatabaseWriteExecutor } from '../runtime';
import {
  RAVEN_CAT_AI_SCHEDULES_OWNER_STATUS_TIME_INDEX,
  RAVEN_CAT_AI_SCHEDULES_OWNER_TIME_INDEX,
  RAVEN_CAT_AI_SCHEDULES_CONSUMED_HISTORY_INDEX,
  RAVEN_CAT_AI_SCHEDULES_SCHEMA,
  RAVEN_CAT_COMPANION_INDEXES,
  RAVEN_CAT_COMPANION_STATE_SCHEMA,
  migrateRavenCatAISchedulesCompletionDisposition,
  migrateRavenCatCompanionStateWakeColumns,
} from './ravenCatCompanionSchema';
import {
  RAVEN_CAT_RELEASE_MANUAL_TEST_LOCKS,
  RAVEN_CAT_SOFT_APP_LOCKS_AI_ACTIVE_TARGET_INDEX,
  RAVEN_CAT_SOFT_APP_LOCKS_SCHEMA,
  RAVEN_CAT_SOFT_APP_LOCKS_STATUS_INDEX,
} from './ravenCatDeviceControlSchema';
import { RAVEN_CAT_FLOATING_INTERACTION_SETTINGS_SCHEMA } from './ravenCatFloatingInteractionSchema';
import { HOST_AI_RELATIONSHIP_STATE_SCHEMA } from './hostAIRelationshipSchema';
import {
  MEDIA_ASSET_CONTENT_HASH_INDEX,
  MEDIA_ASSET_SCHEMA,
} from './mediaAssetSchema';
import { PROMPTING_SCHEMA } from './promptingSchema';
import { migrateProtocolPermanentInjection } from './protocolSchema';
import { migrateUserProfilePersona } from './userProfileSchema';
import { CALL_BACKGROUND_SELECTION_SCHEMA, migrateAssistantCallBackgrounds, migrateCallBackgroundRoleKey } from './callBackgroundSchema';
import { WALLPAPER_SELECTION_SCHEMA } from './wallpaperSelectionSchema';
import { migrateMemoryV3, migrateMemorySummary, MEMORY_PASSIVE_ASSOCIATION_SCHEMA } from './memoryV3Schema';
import { migrateModelSelections, migrateChatImageModelSelections } from './modelSelectionSchema';
import { migrateTranslationModels } from './translationModelSchema';
import { migrateAuxiliaryModelDefaults } from './auxiliaryModelDefaultsSchema';
import { migrateChatSummary, retireChatSummaryCallAssociations } from './chatSummarySchema';
import { migrateChatRegeneration } from './chatRegenerationSchema';
import {
  MCP_SERVERS_SCHEMA,
  MCP_SERVER_ASSISTANTS_SCHEMA,
  MCP_TOOL_GRANTS_SCHEMA,
  MCP_TOOL_GRANTS_INDEXES,
  repairMcpAuthorizationForeignKeys,
} from './mcpSchema';
import { migrateAssistantIdentityContract } from './assistantIdentityMigration';
import { migrateConversationPinTimestamps } from './conversationPinMigration';
import { migrateGroupMentionMetadata } from './groupMentionMetadataMigration';
import { repairConversationTurnForeignKeys } from './conversationTurnIntegrityRepair';
import {
  migrateTogetherListeningActivity,
} from './togetherListeningSchema';
import { STICKER_SCHEMA, STICKER_V2_SCHEMA } from './stickerSchema';
import {
  migrateMomentsAudienceAllExcept,
  migrateMomentSocialInbox,
  migrateMomentMediaAndSettings,
  migrateMomentLocationLabel,
  migrateMomentsV2,
} from './momentsSchema';

/**
 * 运行所有数据库迁移
 * 历史兼容 migration 保持既有行为；新的契约升级失败必须阻断初始化。
 * @param db - bootstrap 协调任务传入的执行器
 */
export async function runMigrations(db: DatabaseWriteExecutor): Promise<void> {
  // 新选择契约提交后，不重建已退休的默认绑定表。快照恢复会保留此版本标记。
  const modelSelectionVersion = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const modelSelectionsMigrated = modelSelectionVersion!.user_version >= 95;

  // 迁移1: Sessions 表 ai_assistant_id 列检查（PRAGMA table_info）和添加
  try {
    const pragmaRows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('sessions')`);
    const colNames = (pragmaRows || []).map(r => r.name || r.name);
    if (pragmaRows.length > 0 && !colNames.includes('ai_assistant_id')) {
      await db.execAsync(`ALTER TABLE sessions ADD COLUMN ai_assistant_id TEXT;`);
    }
  } catch (mErr) {
    // 如果 PRAGMA 或 ALTER 失败，不让初始化中断，记录日志
    console.warn('Session table migration check failed:', mErr);
  }

  // 迁移2: Memories 表 ai_assistant_id 列检查和添加，以及旧数据迁移
  try {
    const pragmaRowsMem = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('memories')`);
    const memColNames = (pragmaRowsMem || []).map(r => r.name || r.name);
    if (pragmaRowsMem.length > 0 && !memColNames.includes('ai_assistant_id')) {
      await db.execAsync(`ALTER TABLE memories ADD COLUMN ai_assistant_id TEXT;`);

      // 尝试把已有的旧记忆分配给默认 AI（如果存在）以保持向后兼容性
      try {
        const defaultAI = await db.getFirstAsync<{ id: string }>(`SELECT id FROM ai_assistants WHERE is_default = 1 LIMIT 1`);
        if (defaultAI && defaultAI.id) {
          await db.runAsync(`UPDATE memories SET ai_assistant_id = ? WHERE ai_assistant_id IS NULL OR ai_assistant_id = ''`, [defaultAI.id]);
        }
      } catch (innerErr) {
        console.warn('Failed to assign existing memories to default AI:', innerErr);
      }
    }
  } catch (mErr) {
    console.warn('Memories table migration check failed:', mErr);
  }

  // 迁移3: ai_assistants 表工具相关列检查和添加
  try {
    const pragmaRowsAi = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('ai_assistants')`);
    const aiColNames = (pragmaRowsAi || []).map(r => r.name || r.name);
    if (pragmaRowsAi.length > 0 && !aiColNames.includes('enable_tools')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN enable_tools INTEGER DEFAULT 0;`);
    }
    if (pragmaRowsAi.length > 0 && !aiColNames.includes('enable_external_tool_search')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN enable_external_tool_search INTEGER DEFAULT 0;`);
    }
    if (pragmaRowsAi.length > 0 && !aiColNames.includes('enable_external_tool_translate')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN enable_external_tool_translate INTEGER DEFAULT 0;`);
    }
    if (pragmaRowsAi.length > 0 && !aiColNames.includes('enable_external_tool_weather')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN enable_external_tool_weather INTEGER DEFAULT 0;`);
    }
    if (pragmaRowsAi.length > 0 && !aiColNames.includes('enable_external_tool_map')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN enable_external_tool_map INTEGER DEFAULT 0;`);
    }
    if (pragmaRowsAi.length > 0 && !aiColNames.includes('enable_short_text_protocol')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN enable_short_text_protocol INTEGER DEFAULT 1;`);
      await db.execAsync(`UPDATE ai_assistants SET enable_short_text_protocol = 1 WHERE enable_short_text_protocol IS NULL;`);
    }
    if (pragmaRowsAi.length > 0 && !aiColNames.includes('supports_vision')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN supports_vision INTEGER DEFAULT 0;`);
      await db.execAsync(`UPDATE ai_assistants SET supports_vision = 0 WHERE supports_vision IS NULL;`);
    }
    if (pragmaRowsAi.length > 0 && !aiColNames.includes('vision_helper_ai_id')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN vision_helper_ai_id TEXT;`);
    }
    if (pragmaRowsAi.length > 0 && !aiColNames.includes('allow_helper_auto_join')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN allow_helper_auto_join INTEGER DEFAULT 1;`);
      await db.execAsync(`UPDATE ai_assistants SET allow_helper_auto_join = 1 WHERE allow_helper_auto_join IS NULL;`);
    }
    if (pragmaRowsAi.length > 0 && !aiColNames.includes('agent_id')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN agent_id TEXT;`);
      await db.execAsync(`UPDATE ai_assistants SET agent_id = 'agent_' || id WHERE agent_id IS NULL OR agent_id = '';`);
      await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_assistants_agent_id ON ai_assistants(agent_id);`);
    }
  } catch (mErr) {
    console.warn('AI assistants table migration check failed:', mErr);
  }

  // 迁移4: app_icons 表创建（若未创建）
  try {
    const pragmaAppIcons = await db.getAllAsync(`PRAGMA table_info('app_icons')`);
    if (!pragmaAppIcons || pragmaAppIcons.length === 0) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS app_icons (
          app_id TEXT PRIMARY KEY,
          custom_name TEXT,
          icon_type TEXT,
          icon_value TEXT,
          updated_at TEXT NOT NULL
        );
      `);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_app_icons_updated_at ON app_icons(updated_at);`);
    }
  } catch (mErr) {
    console.warn('App icons table migration check failed:', mErr);
  }

  // 迁移5: ai_assistants 表 is_ledger_ai 列检查和添加
  try {
    const pragmaRowsAi = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('ai_assistants')`);
    const aiColNames = (pragmaRowsAi || []).map(r => r.name || r.name);
    if (pragmaRowsAi.length > 0 && !aiColNames.includes('is_ledger_ai')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN is_ledger_ai INTEGER DEFAULT 0;`);
    }
  } catch (mErr) {
    console.warn('AI assistants is_ledger_ai column migration check failed:', mErr);
  }

  // 迁移6: 羽库账本相关表创建
  try {
    // 创建 ledger_records 表
    const pragmaLedger = await db.getAllAsync(`PRAGMA table_info('ledger_records')`);
    if (!pragmaLedger || pragmaLedger.length === 0) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ledger_records (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          category TEXT NOT NULL,
          detail TEXT,
          amount REAL NOT NULL,
          record_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_records(record_date);`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger_records(type);`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_ledger_category ON ledger_records(category);`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_ledger_detail ON ledger_records(detail);`);
    }

    // 创建 ledger_quick_actions 表
    const pragmaQuick = await db.getAllAsync(`PRAGMA table_info('ledger_quick_actions')`);
    if (!pragmaQuick || pragmaQuick.length === 0) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ledger_quick_actions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          category TEXT NOT NULL,
          detail TEXT,
          amount REAL NOT NULL,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    }
  } catch (mErr) {
    console.warn('Ledger tables migration check failed:', mErr);
  }

  // 迁移9: messages 表添加引用回复相关字段
  try {
    const pragmaRowsMsg = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('messages')`);
    const msgColNames = (pragmaRowsMsg || []).map(r => r.name);
    
    if (pragmaRowsMsg.length > 0) {
      if (!msgColNames.includes('reply_to_id')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN reply_to_id INTEGER;`);
      }
      if (!msgColNames.includes('reply_to_text')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN reply_to_text TEXT;`);
      }
      if (!msgColNames.includes('status')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'sent';`);
      }
      console.log('✅ messages table columns (reply_to_id, reply_to_text, status) checked');
    }
  } catch (mErr) {
    console.warn('Messages table migration check failed:', mErr);
  }

  // 迁移10: messages 表添加 token 用量追踪字段
  try {
    const pragmaRowsMsg = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('messages')`);
    const msgColNames = (pragmaRowsMsg || []).map(r => r.name);
    
    if (pragmaRowsMsg.length > 0) {
      if (!msgColNames.includes('tokens_used')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN tokens_used INTEGER DEFAULT 0;`);
      }
      if (!msgColNames.includes('prompt_tokens')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER DEFAULT 0;`);
      }
      if (!msgColNames.includes('completion_tokens')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN completion_tokens INTEGER DEFAULT 0;`);
      }
      console.log('✅ messages table token columns (tokens_used, prompt_tokens, completion_tokens) checked');
    }
  } catch (mErr) {
    console.warn('Messages table token columns migration check failed:', mErr);
  }

  // 迁移10.1: messages 表添加 logical segment 相关字段
  try {
    const pragmaRowsMsg = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('messages')`);
    const msgColNames = (pragmaRowsMsg || []).map(r => r.name);

    if (pragmaRowsMsg.length > 0) {
      if (!msgColNames.includes('logical_message_id')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN logical_message_id TEXT;`);
      }
      if (!msgColNames.includes('segment_index')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN segment_index INTEGER DEFAULT 0;`);
      }
      if (!msgColNames.includes('segment_total')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN segment_total INTEGER DEFAULT 1;`);
      }
      if (!msgColNames.includes('delivery_status')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN delivery_status TEXT DEFAULT 'delivered';`);
      }

      await db.execAsync(`UPDATE messages SET segment_index = 0 WHERE segment_index IS NULL;`);
      await db.execAsync(`UPDATE messages SET segment_total = 1 WHERE segment_total IS NULL OR segment_total <= 0;`);
      await db.execAsync(`UPDATE messages SET delivery_status = 'delivered' WHERE delivery_status IS NULL OR delivery_status = '';`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_messages_session_logical_message ON messages(session_id, logical_message_id);`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_messages_logical_segment ON messages(logical_message_id, segment_index);`);
      console.log('✅ messages table logical segment columns checked');
    }
  } catch (mErr) {
    console.warn('Messages table logical segment migration check failed:', mErr);
  }

  // 迁移11: ai_assistants 表添加主理AI相关字段
  try {
    const pragmaRowsAi = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('ai_assistants')`);
    const aiColNames = (pragmaRowsAi || []).map(r => r.name);
    
    if (pragmaRowsAi.length > 0) {
      if (!aiColNames.includes('is_host_ai')) {
        await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN is_host_ai INTEGER DEFAULT 0;`);
      }
      if (!aiColNames.includes('host_cooldown_start')) {
        await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN host_cooldown_start TEXT;`);
      }
      if (!aiColNames.includes('host_cooldown_end')) {
        await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN host_cooldown_end TEXT;`);
      }
      if (!aiColNames.includes('host_revoke_cooldown_start')) {
        await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN host_revoke_cooldown_start TEXT;`);
      }
      if (!aiColNames.includes('host_revoke_cooldown_end')) {
        await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN host_revoke_cooldown_end TEXT;`);
      }
      console.log('✅ ai_assistants table host AI columns checked');
    }
  } catch (mErr) {
    console.warn('AI assistants host columns migration check failed:', mErr);
  }

  // 迁移12: 创建 ai_blacklist 表
  // - ai_id: 被拉黑目标的系统 ai id
  // - blocked_by: 执行动作的 host AI 的系统 ai id（历史字段名，非 agentId）
  try {
    const pragmaBlacklist = await db.getAllAsync(`PRAGMA table_info('ai_blacklist')`);
    if (!pragmaBlacklist || pragmaBlacklist.length === 0) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS ai_blacklist (
          id TEXT PRIMARY KEY,
          ai_id TEXT NOT NULL,
          blocked_by TEXT NOT NULL,
          blocked_until TEXT NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (ai_id) REFERENCES ai_assistants(id) ON DELETE CASCADE
        );
      `);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_ai_blacklist_ai_id ON ai_blacklist(ai_id);`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_ai_blacklist_blocked_by ON ai_blacklist(blocked_by);`);
      console.log('✅ ai_blacklist table created');
    }
  } catch (mErr) {
    console.warn('AI blacklist table migration check failed:', mErr);
  }

  // 迁移13: user_profile 表补充朋友圈封面字段
  try {
    const pragmaRowsUserProfile = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('user_profile')`);
    const userProfileColNames = (pragmaRowsUserProfile || []).map(r => r.name);

    if (pragmaRowsUserProfile.length > 0 && !userProfileColNames.includes('moments_cover')) {
      await db.execAsync(`ALTER TABLE user_profile ADD COLUMN moments_cover TEXT;`);
      console.log('✅ user_profile table column moments_cover checked');
    }
  } catch (mErr) {
    console.warn('User profile moments cover migration check failed:', mErr);
  }

  // Migration 13 removed: legacy amber tables (amber_diaries, amber_diary_segments, amber_profiles, amber_must_remember)

  // 迁移14: sessions 表添加归档相关字段
  try {
    const pragmaRowsSessions = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('sessions')`);
    const sessionColNames = (pragmaRowsSessions || []).map(r => r.name);
    
    if (pragmaRowsSessions.length > 0) {
      if (!sessionColNames.includes('is_archived')) {
        await db.execAsync(`ALTER TABLE sessions ADD COLUMN is_archived INTEGER DEFAULT 0;`);
      }
      if (!sessionColNames.includes('archive_reason')) {
        await db.execAsync(`ALTER TABLE sessions ADD COLUMN archive_reason TEXT;`);
      }
      if (!sessionColNames.includes('tags')) {
        await db.execAsync(`ALTER TABLE sessions ADD COLUMN tags TEXT;`);
      }
      console.log('✅ sessions table archive columns checked');
    }
  } catch (mErr) {
    console.warn('Sessions archive columns migration check failed:', mErr);
  }

  // 迁移14.1: sessions 表添加置顶字段
  try {
    const pragmaRowsSessions = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('sessions')`);
    const sessionColNames = (pragmaRowsSessions || []).map(r => r.name);

    if (pragmaRowsSessions.length > 0) {
      if (!sessionColNames.includes('is_pinned')) {
        await db.execAsync(`ALTER TABLE sessions ADD COLUMN is_pinned INTEGER DEFAULT 0;`);
      }
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(ai_assistant_id, is_pinned, updated_at);`
      );
      console.log('✅ sessions table pinned column checked');
    }
  } catch (mErr) {
    console.warn('Sessions pinned column migration check failed:', mErr);
  }

  // 迁移15: messages 表添加逻辑消息字段（client_message_id / updated_at / metadata_json）
  try {
    const pragmaRowsMsg = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('messages')`);
    const msgColNames = (pragmaRowsMsg || []).map(r => r.name);

    if (pragmaRowsMsg.length > 0) {
      if (!msgColNames.includes('client_message_id')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN client_message_id TEXT;`);
      }
      if (!msgColNames.includes('updated_at')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN updated_at TEXT;`);
        await db.execAsync(`UPDATE messages SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = '';`);
      }
      if (!msgColNames.includes('metadata_json')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN metadata_json TEXT;`);
      }
      if (!msgColNames.includes('agent_id')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN agent_id TEXT;`);
      }

      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_messages_session_client_message ON messages(session_id, client_message_id);`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_messages_agent_id ON messages(agent_id);`);
      console.log('✅ messages table logical message columns (client_message_id, updated_at, metadata_json) checked');
    }
  } catch (mErr) {
    console.warn('Messages logical message columns migration check failed:', mErr);
  }

  // 迁移15.1: messages 表添加时间分隔标记字段，并为历史消息回填 10 分钟断点
  try {
    const pragmaRowsMsg = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('messages')`);
    const msgColNames = (pragmaRowsMsg || []).map(r => r.name);

    if (pragmaRowsMsg.length > 0) {
      if (!msgColNames.includes('show_time_separator_before')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN show_time_separator_before INTEGER DEFAULT 0;`);
      }

      console.log('✅ messages time separator marker column checked');
    }
  } catch (mErr) {
    console.warn('Messages time separator marker migration check failed:', mErr);
  }

  // 迁移16: 记忆库(memories)表重命名为协议空间(protocols)表
  try {
    const pragmaOldMemories = await db.getAllAsync(`PRAGMA table_info('memories')`);
    const pragmaNewProtocols = await db.getAllAsync(`PRAGMA table_info('protocols')`);
    
    // 如果存在旧表 memories 且不存在新表 protocols，则进行迁移
    if (pragmaOldMemories && pragmaOldMemories.length > 0 && (!pragmaNewProtocols || pragmaNewProtocols.length === 0)) {
      console.log('🔄 Migrating memories table to protocols table...');
      
      // 1. 删除旧表（不保留数据，开发阶段允许）
      await db.execAsync(`DROP TABLE IF EXISTS memories;`);
      
      // 2. 创建新表 protocols
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS protocols (
          id TEXT PRIMARY KEY,
          ai_assistant_id TEXT NOT NULL,
          content TEXT NOT NULL,
          summary TEXT,
          priority INTEGER DEFAULT 5,
          effective_date TEXT,
          expiry_date TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (ai_assistant_id) REFERENCES ai_assistants(id) ON DELETE CASCADE
        );
      `);
      
      // 3. 创建索引
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_protocols_ai_id ON protocols(ai_assistant_id);`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_protocols_priority ON protocols(ai_assistant_id, priority DESC);`);
      
      console.log('✅ protocols table created (memories data discarded)');
    }
  } catch (mErr) {
    console.warn('Memories to protocols migration failed:', mErr);
  }

  // Migration 18 removed: legacy session_sticky_notes table

  // 迁移19: 创建 user_profile 表
  try {
    const pragmaUserProfile = await db.getAllAsync(`PRAGMA table_info('user_profile')`);
    if (!pragmaUserProfile || pragmaUserProfile.length === 0) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS user_profile (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          avatar TEXT,
          moments_cover TEXT,
          updated_at TEXT NOT NULL
        );
      `);
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_user_profile_updated_at ON user_profile(updated_at);`
      );
      await db.execAsync(
        `INSERT OR IGNORE INTO user_profile (id, name, avatar, updated_at)
         VALUES ('self', '用户', NULL, '${new Date().toISOString()}');`
      );
      console.log('✅ user_profile table created');
    }

    await db.execAsync(
      `INSERT OR IGNORE INTO user_profile (id, name, avatar, updated_at)
       VALUES ('self', '用户', NULL, '${new Date().toISOString()}');`
    );
  } catch (mErr) {
    console.warn('User profile table migration check failed:', mErr);
  }

  // 迁移20: 创建背景个性化表（历史兼容）
  try {
    const pragmaDesktopPersonalization = await db.getAllAsync(
      `PRAGMA table_info('desktop_personalization')`
    );
    if (!pragmaDesktopPersonalization || pragmaDesktopPersonalization.length === 0) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS desktop_personalization (
          id TEXT PRIMARY KEY,
          wallpaper_type TEXT,
          wallpaper_value TEXT,
          updated_at TEXT NOT NULL
        );
      `);
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_desktop_personalization_updated_at ON desktop_personalization(updated_at);`
      );
      await db.execAsync(
        `INSERT OR IGNORE INTO desktop_personalization (id, wallpaper_type, wallpaper_value, updated_at)
         VALUES ('desktop', NULL, NULL, '${new Date().toISOString()}');`
      );
      console.log('✅ desktop_personalization table created');
    }
  } catch (mErr) {
    console.warn('Desktop personalization table migration check failed:', mErr);
  }

  // 迁移21: 创建 session_vision_helpers 表
  try {
    const pragmaVisionHelpers = await db.getAllAsync(`PRAGMA table_info('session_vision_helpers')`);
    if (!pragmaVisionHelpers || pragmaVisionHelpers.length === 0) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS session_vision_helpers (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          episode_id TEXT NOT NULL,
          primary_ai_id TEXT NOT NULL,
          helper_ai_id TEXT,
          status TEXT NOT NULL,
          turn_count INTEGER DEFAULT 0,
          anchor_image_message_id INTEGER,
          joined_at_message_id INTEGER,
          last_helper_message_id INTEGER,
          reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          closed_at TEXT,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (primary_ai_id) REFERENCES ai_assistants(id) ON DELETE CASCADE,
          FOREIGN KEY (helper_ai_id) REFERENCES ai_assistants(id) ON DELETE SET NULL
        );
      `);
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_session_vision_helpers_session_id ON session_vision_helpers(session_id, updated_at DESC);`
      );
      await db.execAsync(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_session_vision_helpers_episode_id ON session_vision_helpers(episode_id);`
      );
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_session_vision_helpers_active ON session_vision_helpers(session_id, status);`
      );
      console.log('✅ session_vision_helpers table created');
    }
  } catch (mErr) {
    console.warn('Session vision helpers table migration check failed:', mErr);
  }

  // 迁移22: messages 表添加未读状态字段
  try {
    const pragmaRowsMsg = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('messages')`);
    const msgColNames = (pragmaRowsMsg || []).map(r => r.name);

    if (pragmaRowsMsg.length > 0) {
      if (!msgColNames.includes('is_read')) {
        await db.execAsync(`ALTER TABLE messages ADD COLUMN is_read INTEGER DEFAULT 0;`);
        // 历史消息统一回填为已读，避免升级后全部被当成未读
        await db.runAsync(`UPDATE messages SET is_read = 1;`);
      } else {
        await db.runAsync(`UPDATE messages SET is_read = 1 WHERE is_read IS NULL;`);
      }

      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_messages_unread_lookup ON messages(session_id, sender_type, is_me, is_read);`
      );
      console.log('✅ messages table unread column checked');
    }
  } catch (mErr) {
    console.warn('Messages unread column migration check failed:', mErr);
  }

  // 迁移23: 创建共享记忆池第一阶段表（memory_pools / memory_events）
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memory_pools (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL DEFAULT 'pair_shared',
        user_profile_id TEXT NOT NULL,
        ai_assistant_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_profile_id, ai_assistant_id),
        FOREIGN KEY (user_profile_id) REFERENCES user_profile(id) ON DELETE CASCADE,
        FOREIGN KEY (ai_assistant_id) REFERENCES ai_assistants(id) ON DELETE CASCADE
      );
    `);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memory_events (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        unit_kind TEXT NOT NULL,
        session_id TEXT,
        message_id INTEGER,
        ai_assistant_id TEXT,
        speaker_type TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        text TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'text',
        reply_to_event_id TEXT,
        logical_message_id TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_kind, source_id),
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
        FOREIGN KEY (ai_assistant_id) REFERENCES ai_assistants(id) ON DELETE SET NULL,
        FOREIGN KEY (reply_to_event_id) REFERENCES memory_events(id) ON DELETE SET NULL
      );
    `);

    await db.execAsync(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_pools_pair ON memory_pools(user_profile_id, ai_assistant_id);`
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memory_pools_ai_id ON memory_pools(ai_assistant_id);`
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memory_events_pool_created_at ON memory_events(pool_id, created_at DESC);`
    );
    await db.execAsync(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_events_source ON memory_events(source_kind, source_id);`
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memory_events_session_logical ON memory_events(session_id, logical_message_id);`
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memory_events_message_id ON memory_events(message_id);`
    );
  } catch (mErr) {
    console.warn('Shared memory pool tables migration check failed:', mErr);
  }

  // 迁移24: 创建共享记忆池第二阶段表（memories / memory_evidence / memory_overrides）
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        origin_event_id TEXT,
        memory_type TEXT NOT NULL,
        speaker_type TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        about_type TEXT NOT NULL,
        subject_id TEXT,
        predicate TEXT,
        object_text TEXT,
        summary_text TEXT NOT NULL,
        claim_type TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        salience REAL DEFAULT 0.5,
        temporal_kind TEXT NOT NULL DEFAULT 'stable',
        scope TEXT NOT NULL DEFAULT 'pair_shared',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_accessed_at TEXT,
        access_count INTEGER DEFAULT 0,
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE,
        FOREIGN KEY (origin_event_id) REFERENCES memory_events(id) ON DELETE SET NULL
      );
    `);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memory_evidence (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        evidence_role TEXT NOT NULL DEFAULT 'origin',
        weight REAL DEFAULT 1.0,
        created_at TEXT NOT NULL,
        UNIQUE(memory_id, event_id),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES memory_events(id) ON DELETE CASCADE
      );
    `);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memory_overrides (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        operator_actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE
      );
    `);

    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memories_pool_status ON memories(pool_id, status, updated_at DESC);`
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);`
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memories_temporal_status ON memories(temporal_kind, status);`
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memory_evidence_memory_id ON memory_evidence(memory_id);`
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memory_evidence_event_id ON memory_evidence(event_id);`
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memory_overrides_pool_created_at ON memory_overrides(pool_id, created_at DESC);`
    );
  } catch (mErr) {
    console.warn('Shared memory core tables migration check failed:', mErr);
  }

  // Migration 24.1: shared memory embeddings table
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL UNIQUE,
        pool_id TEXT NOT NULL,
        embedding_model_config_id TEXT,
        embedding_model TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE
      );
    `);
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memory_embeddings_pool ON memory_embeddings(pool_id);`
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings(embedding_model_config_id, embedding_model);`
    );
  } catch (mErr) {
    console.warn('Shared memory embeddings table migration check failed:', mErr);
  }

  if (!modelSelectionsMigrated) {
    // 迁移25: 创建辅助模型中心表（auxiliary_model_configs / capability_bindings）
    try {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS auxiliary_model_configs (
          id TEXT PRIMARY KEY,
          capability_kind TEXT NOT NULL,
          name TEXT NOT NULL,
          base_url TEXT NOT NULL,
          api_key TEXT,
          model TEXT NOT NULL,
          temperature REAL,
          top_p REAL,
          max_tokens INTEGER,
          enabled INTEGER DEFAULT 1,
          metadata_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS capability_bindings (
          capability_kind TEXT PRIMARY KEY,
          model_config_id TEXT,
          enabled INTEGER DEFAULT 1,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (model_config_id) REFERENCES auxiliary_model_configs(id) ON DELETE SET NULL
        );
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS assistant_capability_bindings (
          assistant_id TEXT NOT NULL,
          capability_kind TEXT NOT NULL,
          model_config_id TEXT,
          enabled INTEGER DEFAULT 1,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (assistant_id, capability_kind),
          FOREIGN KEY (assistant_id) REFERENCES ai_assistants(id) ON DELETE CASCADE,
          FOREIGN KEY (model_config_id) REFERENCES auxiliary_model_configs(id) ON DELETE SET NULL
        );
      `);

      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_auxiliary_model_configs_updated_at ON auxiliary_model_configs(updated_at DESC);`
      );
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_auxiliary_model_configs_enabled ON auxiliary_model_configs(enabled);`
      );
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_auxiliary_model_configs_capability_kind ON auxiliary_model_configs(capability_kind, updated_at DESC);`
      );
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_capability_bindings_model_config_id ON capability_bindings(model_config_id);`
      );
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_assistant_capability_bindings_capability ON assistant_capability_bindings(capability_kind, assistant_id);`
      );
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_assistant_capability_bindings_model_config_id ON assistant_capability_bindings(model_config_id);`
      );
    } catch (mErr) {
      console.warn('Auxiliary model center tables migration check failed:', mErr);
    }

    // 迁移26: 辅助模型中心补充 capability_kind 与助手级绑定
    try {
      const pragmaAuxiliaryModels = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info('auxiliary_model_configs')`
      );
      const auxiliaryModelColumns = (pragmaAuxiliaryModels || []).map((row) => row.name);

      if (pragmaAuxiliaryModels.length > 0 && !auxiliaryModelColumns.includes('capability_kind')) {
        await db.execAsync(`ALTER TABLE auxiliary_model_configs ADD COLUMN capability_kind TEXT;`);
      }

      if (pragmaAuxiliaryModels.length > 0 || auxiliaryModelColumns.includes('capability_kind')) {
        await db.execAsync(`
          UPDATE auxiliary_model_configs
          SET capability_kind = (
            SELECT capability_kind
            FROM capability_bindings
            WHERE capability_bindings.model_config_id = auxiliary_model_configs.id
            LIMIT 1
          )
          WHERE capability_kind IS NULL OR capability_kind = '';
        `);
        await db.execAsync(`
          UPDATE auxiliary_model_configs
          SET capability_kind = 'extractor'
          WHERE capability_kind IS NULL OR capability_kind = '';
        `);
      }

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS assistant_capability_bindings (
          assistant_id TEXT NOT NULL,
          capability_kind TEXT NOT NULL,
          model_config_id TEXT,
          enabled INTEGER DEFAULT 1,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (assistant_id, capability_kind),
          FOREIGN KEY (assistant_id) REFERENCES ai_assistants(id) ON DELETE CASCADE,
          FOREIGN KEY (model_config_id) REFERENCES auxiliary_model_configs(id) ON DELETE SET NULL
        );
      `);
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_auxiliary_model_configs_capability_kind ON auxiliary_model_configs(capability_kind, updated_at DESC);`
      );
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_assistant_capability_bindings_capability ON assistant_capability_bindings(capability_kind, assistant_id);`
      );
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_assistant_capability_bindings_model_config_id ON assistant_capability_bindings(model_config_id);`
      );
    } catch (mErr) {
      console.warn('Auxiliary model capability kind/assistant binding migration failed:', mErr);
    }

  }

  // 迁移27：旧服务表仅用于历史升级，翻译资产迁移完成后不再创建。
  if (modelSelectionVersion!.user_version < 106) {
    try {
      await db.execAsync(`
      CREATE TABLE IF NOT EXISTS external_service_configs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        credentials_json TEXT NOT NULL,
        options_json TEXT,
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      `);
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_external_service_configs_kind ON external_service_configs(kind, enabled, updated_at DESC);`
      );
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_external_service_configs_provider ON external_service_configs(provider);`
      );
    } catch (mErr) {
      console.warn('External service configs table migration failed:', mErr);
    }
  }

  // Migration 28: group chat MVP storage
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS group_chats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar TEXT,
        last_message TEXT,
        last_time TEXT,
        is_pinned INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS group_chat_members (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        ai_assistant_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(group_id, ai_assistant_id),
        FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE,
        FOREIGN KEY (ai_assistant_id) REFERENCES ai_assistants(id) ON DELETE CASCADE
      );
    `);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS group_chat_admin_configs (
        group_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model TEXT NOT NULL,
        api_key TEXT,
        api_base_url TEXT,
        system_prompt TEXT,
        temperature REAL DEFAULT 0.7,
        top_p REAL DEFAULT 1.0,
        max_tokens INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE
      );
    `);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS group_speech_plans (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        status TEXT NOT NULL,
        invoked_user_message_ids_json TEXT,
        last_included_message_id INTEGER,
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE
      );
    `);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS group_speech_tasks (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        ai_assistant_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        sequence_order INTEGER NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES group_speech_plans(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE,
        FOREIGN KEY (ai_assistant_id) REFERENCES ai_assistants(id) ON DELETE CASCADE
      );
    `);

    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_group_chats_updated_at ON group_chats(updated_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_group_chats_pinned ON group_chats(is_pinned, updated_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_group_chat_members_group_id ON group_chat_members(group_id, display_order);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_group_chat_members_ai_id ON group_chat_members(ai_assistant_id);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_group_speech_plans_group_status ON group_speech_plans(group_id, status, created_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_group_speech_tasks_plan_order ON group_speech_tasks(plan_id, sequence_order);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_group_speech_tasks_group_status ON group_speech_tasks(group_id, status);`);
  } catch (mErr) {
    console.warn('Group chat MVP tables migration failed:', mErr);
  }

  // Migration 29: AI video call truth tables
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS call_sessions (
        id TEXT PRIMARY KEY,
        chat_session_id TEXT NOT NULL,
        ai_assistant_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        state TEXT NOT NULL,
        requested_mode TEXT NOT NULL,
        active_mode TEXT NOT NULL,
        source TEXT NOT NULL,
        source_tool_call_id TEXT,
        opening_line TEXT,
        reason TEXT,
        ai_rejection_reason TEXT,
        started_at TEXT,
        accepted_at TEXT,
        ended_at TEXT,
        end_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (chat_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (ai_assistant_id) REFERENCES ai_assistants(id) ON DELETE CASCADE
      );
    `);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS call_participants (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        role TEXT NOT NULL,
        ai_assistant_id TEXT,
        agent_id TEXT,
        display_name TEXT NOT NULL,
        joined_at TEXT,
        left_at TEXT,
        FOREIGN KEY (call_id) REFERENCES call_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (ai_assistant_id) REFERENCES ai_assistants(id) ON DELETE SET NULL
      );
    `);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS call_events (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        chat_session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        text TEXT,
        attachment_id TEXT,
        visible_in_chat INTEGER DEFAULT 0,
        include_in_ai_context INTEGER DEFAULT 1,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (call_id) REFERENCES call_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (chat_session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS call_attachments (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        event_id TEXT,
        kind TEXT NOT NULL,
        local_uri TEXT,
        mime_type TEXT,
        width INTEGER,
        height INTEGER,
        size_bytes INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (call_id) REFERENCES call_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES call_events(id) ON DELETE SET NULL
      );
    `);

    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_call_sessions_chat_session ON call_sessions(chat_session_id, created_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_call_sessions_state_updated ON call_sessions(state, updated_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_call_sessions_ai_created ON call_sessions(ai_assistant_id, created_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_call_sessions_agent_created ON call_sessions(agent_id, created_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_call_events_call_created ON call_events(call_id, created_at ASC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_call_events_chat_context ON call_events(chat_session_id, include_in_ai_context, created_at DESC);`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_call_attachments_call_created ON call_attachments(call_id, created_at DESC);`);
  } catch (mErr) {
    console.warn('AI video call tables migration failed:', mErr);
  }

  // Migration 30: RavenCat proactive contact settings and point ledger
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS raven_cat_contact_settings (
        id TEXT PRIMARY KEY,
        proactive_contact_enabled INTEGER NOT NULL DEFAULT 1,
        enabled_message_route INTEGER NOT NULL DEFAULT 1,
        enabled_screen_then_message_route INTEGER NOT NULL DEFAULT 0,
        enabled_video_call_route INTEGER NOT NULL DEFAULT 1,
        screen_capture_unobstructed_mode_enabled INTEGER NOT NULL DEFAULT 0,
        screen_capture_app_blacklist_json TEXT NOT NULL DEFAULT '["com.android.settings","com.android.permissioncontroller","com.google.android.permissioncontroller"]',
        screen_capture_retention_policy TEXT NOT NULL DEFAULT 'discard_after_use',
        global_contact_points INTEGER NOT NULL DEFAULT 20,
        last_point_recovery_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const pragmaRows = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('raven_cat_contact_settings')`
    );
    const colNames = pragmaRows.map((row) => row.name);
    // 迁移30 的补列兼容只在数据库仍处于旧 RavenCat contact-settings shape 时执行。
    // 一旦迁移71/74 已把表收敛到 live-only shape（只剩 CompanionSettings 列），本迁移
    // 必须 no-op，否则会重新补回 retired 列，让迁移71 在末尾清理前因
    // enabled_message_route 缺失而失败。
    const legacyShapeMarkers = [
      'proactive_contact_enabled',
      'global_contact_points',
      'last_point_recovery_at',
      'daily_contact_limit',
      'settings_revision',
      'screen_capture_app_blacklist_json',
      'screen_capture_unobstructed_mode_enabled',
      'screen_capture_retention_policy',
    ];
    const isLegacyContactSettingsShape = legacyShapeMarkers.some((column) =>
      colNames.includes(column)
    );
    if (isLegacyContactSettingsShape) {
      if (!colNames.includes('enabled_screen_then_message_route')) {
        await db.execAsync(
          `ALTER TABLE raven_cat_contact_settings ADD COLUMN enabled_screen_then_message_route INTEGER NOT NULL DEFAULT 0;`
        );
      }
      if (!colNames.includes('enabled_video_call_route')) {
        await db.execAsync(
          `ALTER TABLE raven_cat_contact_settings ADD COLUMN enabled_video_call_route INTEGER NOT NULL DEFAULT 1;`
        );
      }
      if (!colNames.includes('screen_capture_unobstructed_mode_enabled')) {
        await db.execAsync(
          `ALTER TABLE raven_cat_contact_settings ADD COLUMN screen_capture_unobstructed_mode_enabled INTEGER NOT NULL DEFAULT 0;`
        );
      }
      if (!colNames.includes('screen_capture_app_blacklist_json')) {
        await db.execAsync(
          `ALTER TABLE raven_cat_contact_settings ADD COLUMN screen_capture_app_blacklist_json TEXT NOT NULL DEFAULT '["com.android.settings","com.android.permissioncontroller","com.google.android.permissioncontroller"]';`
        );
      }
      if (!colNames.includes('screen_capture_retention_policy')) {
        await db.execAsync(
          `ALTER TABLE raven_cat_contact_settings ADD COLUMN screen_capture_retention_policy TEXT NOT NULL DEFAULT 'discard_after_use';`
        );
      }
    }
  } catch (mErr) {
    console.warn('RavenCat contact settings table migration failed:', mErr);
  }

  // Migration 31: RavenCat proactive contact durable trace log
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS raven_cat_contact_traces (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        wake_reason TEXT,
        route TEXT,
        ai_id TEXT,
        session_id TEXT,
        block_reason TEXT,
        points_before_json TEXT,
        points_after_json TEXT,
        ai_visible_explanation TEXT,
        user_notice TEXT,
        message_preview TEXT,
        created_at TEXT NOT NULL
      );
    `);
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_raven_cat_contact_traces_created_at ON raven_cat_contact_traces(created_at DESC);`
    );
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_raven_cat_contact_traces_kind ON raven_cat_contact_traces(kind, created_at DESC);`
    );
  } catch (mErr) {
    console.warn('RavenCat contact trace table migration failed:', mErr);
  }

  // Migration 32: 主题树记忆、可靠草稿队列与管理员变更记录
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memory_topics (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        parent_id TEXT,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        attribute TEXT NOT NULL DEFAULT 'topic',
        current_overview TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES memory_topics(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        remembered_at TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_excerpt TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(topic_id, sequence),
        FOREIGN KEY (topic_id) REFERENCES memory_topics(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_entry_sources (
        entry_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        source_role TEXT NOT NULL DEFAULT 'origin',
        PRIMARY KEY (entry_id, event_id),
        FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES memory_events(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_tags (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(pool_id, category, normalized_name),
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_tag_aliases (
        id TEXT PRIMARY KEY,
        tag_id TEXT NOT NULL,
        pool_id TEXT NOT NULL,
        category TEXT NOT NULL,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(pool_id, category, normalized_alias),
        FOREIGN KEY (tag_id) REFERENCES memory_tags(id) ON DELETE CASCADE,
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_entry_tags (
        entry_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (entry_id, tag_id),
        FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES memory_tags(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_drafts (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        source_logical_message_id TEXT NOT NULL,
        source_ordinal INTEGER NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(pool_id, source_logical_message_id, source_ordinal),
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_ingestion_receipts (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        source_logical_message_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        draft_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(pool_id, source_logical_message_id),
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_change_sets (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        model_source TEXT,
        model_config_id TEXT,
        model_name TEXT,
        prompt_version TEXT,
        status TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        applied_at TEXT,
        UNIQUE(pool_id, batch_id),
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_change_operations (
        id TEXT PRIMARY KEY,
        change_set_id TEXT NOT NULL,
        operation_index INTEGER NOT NULL,
        operation_type TEXT NOT NULL,
        target_id TEXT,
        before_json TEXT,
        after_json TEXT,
        UNIQUE(change_set_id, operation_index),
        FOREIGN KEY (change_set_id) REFERENCES memory_change_sets(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_topics_root_name
        ON memory_topics(pool_id, normalized_name) WHERE parent_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_topics_child_name
        ON memory_topics(pool_id, parent_id, normalized_name) WHERE parent_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_memory_topics_pool_updated
        ON memory_topics(pool_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_entries_topic_timeline
        ON memory_entries(topic_id, remembered_at ASC, sequence ASC);
      CREATE INDEX IF NOT EXISTS idx_memory_tags_pool_category
        ON memory_tags(pool_id, category, normalized_name);
      CREATE INDEX IF NOT EXISTS idx_memory_tag_aliases_tag
        ON memory_tag_aliases(tag_id);
      CREATE INDEX IF NOT EXISTS idx_memory_entry_tags_tag
        ON memory_entry_tags(tag_id, entry_id);
      CREATE INDEX IF NOT EXISTS idx_memory_drafts_queue
        ON memory_drafts(status, priority, next_retry_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_drafts_pool_status
        ON memory_drafts(pool_id, status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_ingestion_receipts_source
        ON memory_ingestion_receipts(pool_id, source_logical_message_id);
      CREATE INDEX IF NOT EXISTS idx_memory_change_sets_pool_created
        ON memory_change_sets(pool_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_change_operations_set
        ON memory_change_operations(change_set_id, operation_index);
    `);

    // 旧 event_id 溯源索引只在旧表结构仍存在时创建；
    // 新消息溯源结构与新索引由后续的记忆清理迁移负责重建。
    const entrySourceColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('memory_entry_sources')`
    );
    if (entrySourceColumns.some((column) => column.name === 'event_id')) {
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_memory_entry_sources_event
          ON memory_entry_sources(event_id, entry_id);
      `);
    }
  } catch (mErr) {
    console.warn('Memory topic tree tables migration failed:', mErr);
  }

  if (!modelSelectionsMigrated) {
    // Migration 33: 能力绑定记录模型来源，支持 memory_admin 复用聊天模型
    try {
      const capabilityBindingColumns = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info('capability_bindings')`
      );
      if (!capabilityBindingColumns.some((column) => column.name === 'model_source')) {
        await db.execAsync(
          `ALTER TABLE capability_bindings
           ADD COLUMN model_source TEXT NOT NULL DEFAULT 'auxiliary_model';`
        );
      }

      const assistantBindingColumns = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info('assistant_capability_bindings')`
      );
      if (!assistantBindingColumns.some((column) => column.name === 'model_source')) {
        await db.execAsync(
          `ALTER TABLE assistant_capability_bindings
           ADD COLUMN model_source TEXT NOT NULL DEFAULT 'auxiliary_model';`
        );
      }
    } catch (mErr) {
      console.warn('Capability binding model source migration failed:', mErr);
    }

  }

  // Migration 34: 记录管理员变更集的补偿撤销时间
  try {
    const memoryChangeSetColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('memory_change_sets')`
    );
    if (!memoryChangeSetColumns.some((column) => column.name === 'reverted_at')) {
      await db.execAsync(
        `ALTER TABLE memory_change_sets
         ADD COLUMN reverted_at TEXT;`
      );
    }
  } catch (mErr) {
    console.warn('Memory change set reverted time migration failed:', mErr);
  }

  // Migration 35: 按记忆空间控制旧链路、影子对比与主题树正式模式
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memory_runtime_modes (
        pool_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'topic_tree' CHECK (mode IN ('legacy', 'shadow', 'topic_tree')),
        updated_at TEXT NOT NULL,
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_runtime_modes_mode
        ON memory_runtime_modes(mode, updated_at DESC);
      INSERT OR IGNORE INTO memory_runtime_modes (pool_id, mode, updated_at)
        SELECT id, 'legacy', CURRENT_TIMESTAMP FROM memory_pools;
    `);
  } catch (mErr) {
    console.warn('Memory runtime mode migration failed:', mErr);
  }

  // Migration 36: 记录久远记忆条目的人工复核时间
  try {
    const memoryEntryColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('memory_entries')`
    );
    if (!memoryEntryColumns.some((column) => column.name === 'reviewed_at')) {
      await db.execAsync(
        `ALTER TABLE memory_entries ADD COLUMN reviewed_at TEXT;`
      );
    }
  } catch (mErr) {
    console.warn('Memory entry review time migration failed:', mErr);
  }

  // Migration 37: 持久化不含原始输入的分池影子召回对比
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memory_shadow_comparisons (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        input_fingerprint TEXT NOT NULL,
        legacy_result_count INTEGER NOT NULL,
        topic_tree_result_count INTEGER NOT NULL,
        topic_tree_topic_ids_json TEXT NOT NULL,
        matched_tags_json TEXT NOT NULL,
        legacy_latency_ms INTEGER NOT NULL,
        topic_tree_latency_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (pool_id) REFERENCES memory_pools(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_shadow_comparisons_pool
        ON memory_shadow_comparisons(pool_id, created_at DESC);
    `);
  } catch (mErr) {
    console.warn('Memory shadow comparison migration failed:', mErr);
  }

  // 迁移38：持久化记忆页默认 AI 与自动整理阈值
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memory_preferences (
        id TEXT PRIMARY KEY,
        preferred_assistant_id TEXT,
        auto_organize_draft_threshold INTEGER NOT NULL DEFAULT 10
          CHECK (auto_organize_draft_threshold IN (5, 10, 20, 50)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO memory_preferences (
        id, preferred_assistant_id, auto_organize_draft_threshold, created_at, updated_at
      ) VALUES ('default', NULL, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    `);
  } catch (mErr) {
    console.warn('Memory preferences migration failed:', mErr);
  }

  // 迁移39：补充主动联系事件幂等键、视觉路线与降级诊断字段
  try {
    const traceColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('raven_cat_contact_traces')`
    );
    const traceColumnNames = new Set(traceColumns.map((column) => column.name));
    const traceColumnsToAdd = [
      ['native_wake_event_id', 'TEXT'],
      ['vision_route', 'TEXT'],
      ['ocr_succeeded', 'INTEGER'],
      ['degraded', 'INTEGER'],
      ['error_category', 'TEXT'],
    ] as const;
    for (const [columnName, columnType] of traceColumnsToAdd) {
      if (!traceColumnNames.has(columnName)) {
        await db.execAsync(
          `ALTER TABLE raven_cat_contact_traces ADD COLUMN ${columnName} ${columnType};`
        );
      }
    }
  } catch (mErr) {
    console.warn('RavenCat contact trace diagnostics migration failed:', mErr);
  }

  // 迁移40：建立“本地伴随”正式设置、状态和主理 AI 唯一约束
  try {
    const settingsColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('raven_cat_contact_settings')`
    );
    const settingsColumnNames = new Set(settingsColumns.map((column) => column.name));
    const settingsColumnsToAdd = [
      [
        'quiet_hours_start_minutes',
        'INTEGER NOT NULL DEFAULT 1380 CHECK (quiet_hours_start_minutes BETWEEN 0 AND 1439)',
      ],
      [
        'quiet_hours_end_minutes',
        'INTEGER NOT NULL DEFAULT 480 CHECK (quiet_hours_end_minutes BETWEEN 0 AND 1439)',
      ],
      [
        'user_screen_capture_blacklist_json',
        "TEXT NOT NULL DEFAULT '[]'",
      ],
    ] as const;
    for (const [columnName, columnDefinition] of settingsColumnsToAdd) {
      if (!settingsColumnNames.has(columnName)) {
        await db.execAsync(
          `ALTER TABLE raven_cat_contact_settings ADD COLUMN ${columnName} ${columnDefinition};`
        );
      }
    }

    await db.execAsync(RAVEN_CAT_COMPANION_STATE_SCHEMA);
    await db.execAsync(HOST_AI_RELATIONSHIP_STATE_SCHEMA);

    const latestLegacyRevocation = await db.getFirstAsync<{
      id: string;
      host_revoke_cooldown_start: string;
      host_revoke_cooldown_end: string;
    }>(
      `SELECT id, host_revoke_cooldown_start, host_revoke_cooldown_end
       FROM ai_assistants
       WHERE is_host_ai = 0
         AND host_revoke_cooldown_start IS NOT NULL
         AND host_revoke_cooldown_end IS NOT NULL
       ORDER BY host_revoke_cooldown_end DESC
       LIMIT 1`
    );
    const relationshipCreatedAt = new Date().toISOString();
    await db.runAsync(
      `INSERT OR IGNORE INTO host_ai_relationship_state (
         id, last_revoked_ai_id, appointment_cooldown_start,
         appointment_cooldown_end, created_at, updated_at
       ) VALUES ('default', ?, ?, ?, ?, ?)`,
      [
        latestLegacyRevocation?.id ?? null,
        latestLegacyRevocation?.host_revoke_cooldown_start ?? null,
        latestLegacyRevocation?.host_revoke_cooldown_end ?? null,
        relationshipCreatedAt,
        relationshipCreatedAt,
      ]
    );

    // 历史异常数据只保留最近更新的一位主理 AI，随后由部分唯一索引兜底。
    await db.execAsync(`
      UPDATE ai_assistants
      SET is_host_ai = 0
      WHERE is_host_ai = 1
        AND id <> (
          SELECT id FROM ai_assistants
          WHERE is_host_ai = 1
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        );
    `);
    for (const indexSql of RAVEN_CAT_COMPANION_INDEXES) {
      await db.execAsync(indexSql);
    }
  } catch (mErr) {
    console.warn('RavenCat local companion foundation migration failed:', mErr);
  }

  // 迁移41：持久化用户提示词片段、预设条目与场景绑定
  try {
    await db.execAsync(PROMPTING_SCHEMA);
  } catch (mErr) {
    console.warn('Prompting user configuration migration failed:', mErr);
  }

  // 迁移42：按 AI 保存语言、内置覆盖和用户提示词；旧编排数据只复制不删除
  try {
    await db.execAsync(PROMPTING_SCHEMA);
    await db.execAsync(`
      INSERT OR IGNORE INTO assistant_prompt_settings (
        assistant_id, language_mode, created_at, updated_at
      )
      SELECT id, 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM ai_assistants;

      INSERT OR IGNORE INTO assistant_user_prompts (
        id, assistant_id, name, content, condition, enabled,
        sort_order, created_at, updated_at
      )
      SELECT
        'legacy:' || b.id || ':' || c.id,
        b.target_id,
        c.name,
        c.content,
        CASE p.scenario_id
          WHEN 'chat.private_reply' THEN 'private_chat'
          WHEN 'chat.group_member_reply' THEN 'group_chat'
          WHEN 'call.live_reply' THEN 'call'
          WHEN 'moments.interaction' THEN 'moments'
          WHEN 'raven_cat.proactive_message' THEN 'raven_cat_proactive'
          ELSE 'always'
        END,
        i.enabled,
        i.sort_order,
        c.created_at,
        c.updated_at
      FROM prompt_bindings b
      JOIN prompt_presets p ON p.id = b.preset_id
      JOIN prompt_preset_items i ON i.preset_id = p.id
      JOIN prompt_custom_blocks c ON c.id = i.definition_id
      WHERE b.target_type = 'assistant' AND b.target_id IS NOT NULL;

      INSERT OR IGNORE INTO assistant_user_prompts (
        id, assistant_id, name, content, condition, enabled,
        sort_order, created_at, updated_at
      )
      SELECT
        'legacy-global:' || b.id || ':' || a.id || ':' || c.id,
        a.id,
        c.name,
        c.content,
        CASE p.scenario_id
          WHEN 'chat.private_reply' THEN 'private_chat'
          WHEN 'chat.group_member_reply' THEN 'group_chat'
          WHEN 'call.live_reply' THEN 'call'
          WHEN 'moments.interaction' THEN 'moments'
          WHEN 'raven_cat.proactive_message' THEN 'raven_cat_proactive'
          ELSE 'always'
        END,
        i.enabled,
        i.sort_order,
        c.created_at,
        c.updated_at
      FROM prompt_bindings b
      CROSS JOIN ai_assistants a
      JOIN prompt_presets p ON p.id = b.preset_id
      JOIN prompt_preset_items i ON i.preset_id = p.id
      JOIN prompt_custom_blocks c ON c.id = i.definition_id
      WHERE b.target_type = 'global';

      INSERT OR IGNORE INTO prompt_migration_orphans (
        id, source_type, source_id, reason, created_at
      )
      SELECT
        'orphan:custom:' || c.id,
        'custom_block',
        c.id,
        '旧自定义片段无法唯一归属到某个 AI；正文继续保留在旧表，可在高级迁移区处理。',
        CURRENT_TIMESTAMP
      FROM prompt_custom_blocks c
      WHERE NOT EXISTS (
        SELECT 1 FROM prompt_preset_items i
        JOIN prompt_bindings b ON b.preset_id = i.preset_id
        WHERE i.definition_id = c.id AND b.target_type IN ('assistant', 'global')
      );

      INSERT OR IGNORE INTO prompt_migration_orphans (
        id, source_type, source_id, reason, created_at
      )
      SELECT
        'orphan:binding:' || b.id,
        'binding',
        b.id,
        '群聊绑定不能自动解释为单个聊天 AI 的长期提示词；旧绑定继续保留。',
        CURRENT_TIMESTAMP
      FROM prompt_bindings b
      WHERE b.target_type = 'group';
    `);
  } catch (mErr) {
    console.warn('Assistant prompt configuration migration failed:', mErr);
  }

  // 迁移43：把旧“短文本”开关解释为“允许多气泡”，保留旧列供迁移期兼容
  try {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('ai_assistants')`);
    if (!columns.some((column) => column.name === 'allow_multiple_bubbles')) {
      await db.execAsync(`ALTER TABLE ai_assistants ADD COLUMN allow_multiple_bubbles INTEGER DEFAULT 1;`);
      await db.execAsync(`
        UPDATE ai_assistants
        SET allow_multiple_bubbles = CASE WHEN enable_short_text_protocol = 0 THEN 0 ELSE 1 END;
      `);
    }
  } catch (mErr) {
    console.warn('Assistant multi-bubble setting migration failed:', mErr);
  }

  // 迁移44：建立通用逐工具权限表；未写覆盖时由注册元数据决定默认值
  try {
    await db.execAsync(PROMPTING_SCHEMA);
  } catch (mErr) {
    console.warn('Assistant tool permission migration failed:', mErr);
  }

  // 迁移45：为主动联系路线失败补充 Episode 与可交给 AI 的行动回执证据
  try {
    const traceColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('raven_cat_contact_traces')`
    );
    const traceColumnNames = new Set(traceColumns.map((column) => column.name));
    const actionOutcomeColumns = [
      ['contact_episode_id', 'TEXT'],
      ['action_stage', 'TEXT'],
      ['action_outcome', 'TEXT'],
      ['evidence_code', 'TEXT'],
      ['acknowledged_at', 'TEXT'],
    ] as const;
    for (const [columnName, columnType] of actionOutcomeColumns) {
      if (!traceColumnNames.has(columnName)) {
        await db.execAsync(
          `ALTER TABLE raven_cat_contact_traces ADD COLUMN ${columnName} ${columnType};`
        );
      }
    }
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_raven_cat_contact_traces_episode
        ON raven_cat_contact_traces(contact_episode_id, created_at ASC);
    `);
  } catch (mErr) {
    console.warn('RavenCat action outcome evidence migration failed:', mErr);
  }

  // 迁移46：保存完整消息组证据。
  //
  // 历史上这里还给 raven_cat_companion_state 补建 desired_wake_at / continuity_deadline /
  // effective_wake_at / wake_intent_summary / wake_adjustment_reason，并从 next_wake_at 回填。
  // 这批 CompanionState wake 单值已由迁移72b 退役（Self Wake 有自己的持久真值），
  // 所以这里不再复活它们：否则每次 bootstrap 都会把已退役列加回来，让 72b 每启动重建一次
  // raven_cat_companion_state（数据不丢但物理表反复重建）。缺列的兼容责任已由迁移71 承担。
  try {
    const traceColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('raven_cat_contact_traces')`
    );
    if (!traceColumns.some((column) => column.name === 'message_ids_json')) {
      await db.execAsync(
        `ALTER TABLE raven_cat_contact_traces
         ADD COLUMN message_ids_json TEXT NOT NULL DEFAULT '[]';`
      );
    }
  } catch (mErr) {
    console.warn('RavenCat continuity and message group migration failed:', mErr);
  }

  // 迁移47：清理外键未启用期间删除主题后遗留的孤立记忆数据
  try {
    await db.execAsync(`
      WITH RECURSIVE orphan_topics(id) AS (
        SELECT child.id
        FROM memory_topics child
        LEFT JOIN memory_topics parent ON parent.id = child.parent_id
        WHERE child.parent_id IS NOT NULL AND parent.id IS NULL

        UNION

        SELECT child.id
        FROM memory_topics child
        JOIN orphan_topics orphan ON child.parent_id = orphan.id
      )
      DELETE FROM memory_topics
      WHERE id IN (SELECT id FROM orphan_topics);

      DELETE FROM memory_entries
      WHERE NOT EXISTS (
        SELECT 1 FROM memory_topics topic WHERE topic.id = memory_entries.topic_id
      );

      DELETE FROM memory_entry_tags
      WHERE NOT EXISTS (
        SELECT 1 FROM memory_entries entry WHERE entry.id = memory_entry_tags.entry_id
      ) OR NOT EXISTS (
        SELECT 1 FROM memory_tags tag WHERE tag.id = memory_entry_tags.tag_id
      );
    `);

    // entry_sources 的事件溯源清理由旧结构决定：迁移56 已删除 memory_events 并
    // 重建 entry_sources（消息溯源），仅当旧结构仍存在时才执行这段历史清理。
    const entrySourceColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('memory_entry_sources')`
    );
    const memoryEventsTable = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'`
    );
    if (memoryEventsTable && entrySourceColumns.some((column) => column.name === 'event_id')) {
      await db.execAsync(`
        DELETE FROM memory_entry_sources
        WHERE NOT EXISTS (
          SELECT 1 FROM memory_entries entry WHERE entry.id = memory_entry_sources.entry_id
        ) OR NOT EXISTS (
          SELECT 1 FROM memory_events event WHERE event.id = memory_entry_sources.event_id
        );
      `);
    }
  } catch (mErr) {
    console.warn('Memory orphan topic cleanup migration failed:', mErr);
  }

  // 迁移48：建立 Agent Runtime 的运行快照、step 和工具回执表。
  try {
    await db.execAsync(`
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

      CREATE INDEX IF NOT EXISTS idx_agent_runs_status_updated
        ON agent_runs(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_assistant_updated
        ON agent_runs(assistant_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_steps_run
        ON agent_steps(run_id, step_index);
      CREATE INDEX IF NOT EXISTS idx_agent_receipts_run_updated
        ON agent_tool_receipts(run_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_receipts_executing
        ON agent_tool_receipts(status, idempotency, updated_at ASC);
    `);
  } catch (mErr) {
    throw new Error('Agent Runtime checkpoint migration failed', { cause: mErr });
  }

  // 迁移50：MCP Server 配置、连接诊断与逐工具授权。
  // bearer token 不允许明文落库；auth_mode 为 none 时 credential_ref 恒为 NULL。
  try {
    await db.execAsync(MCP_SERVERS_SCHEMA);
    await db.execAsync(MCP_TOOL_GRANTS_SCHEMA);
    for (const indexSql of MCP_TOOL_GRANTS_INDEXES) {
      await db.execAsync(indexSql);
    }
  } catch (mErr) {
    throw new Error('MCP Server 配置迁移失败', { cause: mErr });
  }

  // 迁移51：MCP Server 增加协议诊断与端点分类字段。
  // last_negotiated_protocol_version / last_protocol_family 记录最近成功协商的协议；
  // endpoint_class 由统一 validateMcpServerEndpoint 写入，UI/Repository/MCP Client 不各自实现分类。
  try {
    const mcpServerColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('mcp_servers')`
    );
    const mcpServerColumnNames = new Set(mcpServerColumns.map((column) => column.name));
    const mcpColumnsToAdd = [
      ['last_negotiated_protocol_version', 'TEXT'],
      ['last_protocol_family', 'TEXT'],
      ['endpoint_class', 'TEXT'],
    ] as const;
    for (const [columnName, columnType] of mcpColumnsToAdd) {
      if (!mcpServerColumnNames.has(columnName)) {
        await db.execAsync(
          `ALTER TABLE mcp_servers ADD COLUMN ${columnName} ${columnType};`
        );
      }
    }
  } catch (mErr) {
    throw new Error('MCP Server 协议诊断字段迁移失败', { cause: mErr });
  }

  // 迁移54：建立 direct/group 统一 conversation identity，并迁移 messages 外键。
  // chat_conversations 只表达身份（id + kind），sessions / group_chats 仍作为详情行保留。
  try {
    // 5.1 创建父表（幂等）。
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('direct', 'group'))
      );
    `);

    // 5.2 检查 ID 冲突：同一个 ID 不能同时是 direct session 和 group。
    const idConflict = await db.getFirstAsync<{ id: string }>(
      `SELECT s.id
       FROM sessions s
       INNER JOIN group_chats g ON g.id = s.id
       LIMIT 1`,
    );
    if (idConflict) {
      throw new Error(
        `会话 ID 冲突：${idConflict.id} 同时存在于 sessions 与 group_chats，` +
        `无法判断其身份类型，拒绝迁移`,
      );
    }

    // 5.3 检查已有 identity 的类型冲突（支持上一次部分执行后的恢复）。
    const directKindConflict = await db.getFirstAsync<{ id: string }>(
      `SELECT c.id
       FROM chat_conversations c
       INNER JOIN sessions s ON s.id = c.id
       WHERE c.kind != 'direct'
       LIMIT 1`,
    );
    if (directKindConflict) {
      throw new Error(
        `会话身份类型冲突：${directKindConflict.id} 已有 identity 但不是 direct，` +
        `却存在对应 sessions 详情行，拒绝迁移`,
      );
    }
    const groupKindConflict = await db.getFirstAsync<{ id: string }>(
      `SELECT c.id
       FROM chat_conversations c
       INNER JOIN group_chats g ON g.id = c.id
       WHERE c.kind != 'group'
       LIMIT 1`,
    );
    if (groupKindConflict) {
      throw new Error(
        `会话身份类型冲突：${groupKindConflict.id} 已有 identity 但不是 group，` +
        `却存在对应 group_chats 详情行，拒绝迁移`,
      );
    }

    // 5.4 回填 identity；INSERT OR IGNORE 只允许用于已完成冲突检查后的历史回填。
    await db.execAsync(`
      INSERT OR IGNORE INTO chat_conversations (id, kind)
      SELECT id, 'direct' FROM sessions;
    `);
    await db.execAsync(`
      INSERT OR IGNORE INTO chat_conversations (id, kind)
      SELECT id, 'group' FROM group_chats;
    `);

    // 5.5 处理孤立消息：每条消息必须归属 sessions 或 group_chats。
    //     54 之前的老版本删除会话只删 sessions 行，消息残留为孤儿且 UI 永不可达；
    //     删除不改变任何用户可见状态，因此记录审计（console 诊断 + 持久化审计表）后删除，
    //     不再拒绝迁移——老设备上的历史孤儿数据否则永远无法完成升级。
    const orphanRows = await db.getAllAsync<{
      session_id: string;
      message_count: number;
    }>(
      `SELECT m.session_id AS session_id, COUNT(*) AS message_count
       FROM messages m
       LEFT JOIN sessions s ON s.id = m.session_id
       LEFT JOIN group_chats g ON g.id = m.session_id
       WHERE s.id IS NULL
         AND g.id IS NULL
       GROUP BY m.session_id`,
    );
    if (orphanRows.length > 0) {
      console.warn(
        `[persistence:sqlite.bootstrap] 迁移54：发现 ${orphanRows.length} 个已删除会话残留的孤立消息，` +
          `审计落库后删除：${orphanRows
            .map((row) => `${row.session_id}(${row.message_count}条)`)
            .join(', ')}`,
      );

      // 持久化审计：记录被删孤立消息的来源 session 与数量，供真机升级排障回溯。
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS chat_orphan_message_audit (
          session_id TEXT PRIMARY KEY,
          message_count INTEGER NOT NULL,
          deleted_at TEXT NOT NULL
        );
      `);
      const orphanDeletedAt = new Date().toISOString();
      for (const row of orphanRows) {
        await db.runAsync(
          `INSERT OR REPLACE INTO chat_orphan_message_audit (session_id, message_count, deleted_at)
           VALUES (?, ?, ?);`,
          [row.session_id, row.message_count, orphanDeletedAt],
        );
      }

      await db.execAsync(`
        DELETE FROM messages
        WHERE session_id NOT IN (SELECT id FROM sessions)
          AND session_id NOT IN (SELECT id FROM group_chats);
      `);
    }

    // 5.6 检查无详情的 identity：回填后不允许留下空壳身份行。
    const detailLessIdentityRows = await db.getAllAsync<{ id: string }>(
      `SELECT c.id
       FROM chat_conversations c
       LEFT JOIN sessions s ON s.id = c.id
       LEFT JOIN group_chats g ON g.id = c.id
       WHERE s.id IS NULL
         AND g.id IS NULL
       LIMIT 20`,
    );
    if (detailLessIdentityRows.length > 0) {
      throw new Error(
        `存在无详情行的会话身份，拒绝迁移：` +
        `id=${detailLessIdentityRows.map((row) => row.id).join(', ')}`,
      );
    }

    // 5.7 用 PRAGMA foreign_key_list 判断 messages 是否已正确引用 chat_conversations(id)
    //     且保留 ON DELETE CASCADE；只有不满足时才重建。
    const messagesForeignKeys = await db.getAllAsync<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>(`PRAGMA foreign_key_list('messages')`);
    const messagesFkIsCorrect = messagesForeignKeys.some(
      (fk) =>
        fk.table === 'chat_conversations' &&
        fk.from === 'session_id' &&
        fk.to === 'id' &&
        fk.on_delete === 'CASCADE',
    );

    if (!messagesFkIsCorrect) {
      // 5.8/5.9 重建 messages；外键开关必须在事务开始前关闭。
      // 恢复外键后必须读取 PRAGMA 状态验证，不能只依赖 execAsync 不抛错。
      const restoreForeignKeys = async (): Promise<void> => {
        await db.execAsync('PRAGMA foreign_keys = ON;');

        const state = await db.getFirstAsync<{ foreign_keys: number }>(
          'PRAGMA foreign_keys;',
        );

        if (state?.foreign_keys !== 1) {
          throw new Error('迁移54：无法恢复 SQLite foreign_keys');
        }
      };
      let foreignKeysRestored = false;
      try {
        await db.execAsync('PRAGMA foreign_keys = OFF;');
        await db.execAsync('BEGIN;');

        // 复制前后必须校验数量与最大 id，防止数据丢失或 ID 错位。
        const beforeCountRow = await db.getFirstAsync<{ c: number }>(
          'SELECT COUNT(*) AS c FROM messages',
        );
        const beforeMaxIdRow = await db.getFirstAsync<{ m: number | null }>(
          'SELECT MAX(id) AS m FROM messages',
        );
        const beforeCount = beforeCountRow?.c ?? 0;
        const beforeMaxId = beforeMaxIdRow?.m ?? null;

        await db.execAsync(`
          CREATE TABLE messages_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            agent_id TEXT,
            client_message_id TEXT,
            text TEXT NOT NULL,
            is_me INTEGER NOT NULL,
            sender_type TEXT,
            api_message_id TEXT,
            time TEXT,
            created_at TEXT NOT NULL,
            show_time_separator_before INTEGER DEFAULT 0,
            updated_at TEXT,
            reply_to_id INTEGER,
            reply_to_text TEXT,
            logical_message_id TEXT,
            segment_index INTEGER DEFAULT 0,
            segment_total INTEGER DEFAULT 1,
            delivery_status TEXT DEFAULT 'delivered',
            status TEXT DEFAULT 'sent',
            tokens_used INTEGER DEFAULT 0,
            prompt_tokens INTEGER DEFAULT 0,
            completion_tokens INTEGER DEFAULT 0,
            metadata_json TEXT,
            is_read INTEGER DEFAULT 0,
            FOREIGN KEY (session_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
          );
        `);
        // 显式列清单复制，禁止 SELECT * 隐式依赖列顺序。
        await db.execAsync(`
          INSERT INTO messages_new (
            id, session_id, agent_id, client_message_id, text, is_me, sender_type,
            api_message_id, time, created_at, show_time_separator_before, updated_at,
            reply_to_id, reply_to_text, logical_message_id, segment_index, segment_total,
            delivery_status, status, tokens_used, prompt_tokens, completion_tokens,
            metadata_json, is_read
          )
          SELECT
            id, session_id, agent_id, client_message_id, text, is_me, sender_type,
            api_message_id, time, created_at, show_time_separator_before, updated_at,
            reply_to_id, reply_to_text, logical_message_id, segment_index, segment_total,
            delivery_status, status, tokens_used, prompt_tokens, completion_tokens,
            metadata_json, is_read
          FROM messages;
        `);

        const afterCountRow = await db.getFirstAsync<{ c: number }>(
          'SELECT COUNT(*) AS c FROM messages_new',
        );
        const afterMaxIdRow = await db.getFirstAsync<{ m: number | null }>(
          'SELECT MAX(id) AS m FROM messages_new',
        );
        const afterCount = afterCountRow?.c ?? 0;
        const afterMaxId = afterMaxIdRow?.m ?? null;
        if (afterCount !== beforeCount || afterMaxId !== beforeMaxId) {
          throw new Error(
            `messages 重建前后不一致：复制前 ${beforeCount} 行（max id ${beforeMaxId}），` +
            `复制后 ${afterCount} 行（max id ${afterMaxId}），拒绝提交`,
          );
        }

        await db.execAsync('DROP TABLE messages;');
        await db.execAsync('ALTER TABLE messages_new RENAME TO messages;');
        // 重建会丢掉 AUTOINCREMENT 序列，必须恢复到最大 id，
        // 保证下一次插入生成的 ID 不会覆盖历史 ID（memory_events.message_id 等旧引用不错位）。
        await db.execAsync(`DELETE FROM sqlite_sequence WHERE name = 'messages';`);
        await db.execAsync(`
          INSERT INTO sqlite_sequence (name, seq)
          SELECT 'messages', COALESCE(MAX(id), 0) FROM messages;
        `);

        await db.execAsync('COMMIT;');
        // 成功路径也必须验证 foreign_keys 实际恢复。
        await restoreForeignKeys();
        foreignKeysRestored = true;
      } catch (rebuildError) {
        try {
          await db.execAsync('ROLLBACK;');
        } catch {
          // 事务可能尚未开始或已提交，回滚失败不影响后续恢复外键。
        }
        try {
          // 失败后的恢复路径同样必须验证 foreign_keys 实际恢复。
          await restoreForeignKeys();
          foreignKeysRestored = true;
        } catch (fkRestoreError) {
          throw new Error(
            `迁移54：messages 重建失败且无法恢复外键约束：` +
            `${rebuildError instanceof Error ? rebuildError.message : String(rebuildError)}`,
            { cause: fkRestoreError },
          );
        }
        throw rebuildError;
      } finally {
        if (!foreignKeysRestored) {
          try {
            await db.execAsync('PRAGMA foreign_keys = ON;');
          } catch {
            // 最后兜底，原始错误继续抛出。
          }
        }
      }
    }

    // 5.9 重建完成且外键已恢复后，执行整体外键校验；发现任何违规必须失败。
    const messageFkViolations = await db.getAllAsync<{ table: string; rowid: number }>(
      `PRAGMA foreign_key_check('messages')`,
    );
    if (messageFkViolations.length > 0) {
      throw new Error(
        `迁移54：messages 外键校验失败，存在 ${messageFkViolations.length} 条违规记录`,
      );
    }
  } catch (mErr) {
    // 保留原始 cause，孤立消息 ID、冲突 ID 等必须出现在错误链中。
    throw new Error(
      `迁移54：建立 direct/group 统一 conversation identity 失败：` +
      `${mErr instanceof Error ? mErr.message : String(mErr)}`,
      { cause: mErr },
    );
  }

  // 迁移55：Phase 5A ConversationTurnCoordinator 回合协调表与 messages 回合归属列。
  // 外键目标是 chat_conversations(id)（方案 16.1），删除会话级联清理回合事实。
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS conversation_turn_runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        reply_cursor_at_claim INTEGER NOT NULL,
        input_high_watermark INTEGER NOT NULL,
        revision_at_claim INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN
          ('active','committed','superseded','cancelled','failed')),
        terminal_reason TEXT NULL,
        created_at TEXT NOT NULL,
        terminal_at TEXT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_turn_state (
        session_id TEXT PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
        reply_cursor INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        active_run_id TEXT NULL REFERENCES conversation_turn_runs(run_id),
        active_run_kind TEXT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const turnMessageColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('messages')`,
    );
    const turnMessageColumnNames = new Set(turnMessageColumns.map((column) => column.name));
    if (!turnMessageColumnNames.has('turn_run_id')) {
      await db.execAsync(`ALTER TABLE messages ADD COLUMN turn_run_id TEXT NULL;`);
    }
    if (!turnMessageColumnNames.has('turn_item_index')) {
      await db.execAsync(`ALTER TABLE messages ADD COLUMN turn_item_index INTEGER NULL;`);
    }

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_turn_runs_recovery
        ON conversation_turn_runs(session_id, status, input_high_watermark);
      CREATE INDEX IF NOT EXISTS idx_turn_runs_session_history
        ON conversation_turn_runs(session_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_runs_single_active
        ON conversation_turn_runs(session_id) WHERE status = 'active';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_turn_item
        ON messages(turn_run_id, turn_item_index) WHERE turn_run_id IS NOT NULL;
    `);

    // 回填（方案第 9 节产品取舍）：5A 生效前的既有时间线视为历史已消费，
    // reply_cursor 直接落在每会话 MAX(messages.id)，升级前未回复的尾部用户消息不被自动恢复。
    // INSERT OR IGNORE 保证重复执行不覆盖已被回合流程推进的游标。
    await db.runAsync(
      `INSERT OR IGNORE INTO conversation_turn_state
         (session_id, reply_cursor, revision, active_run_id, active_run_kind, updated_at)
       SELECT c.id,
              COALESCE((SELECT MAX(m.id) FROM messages m WHERE m.session_id = c.id), 0),
              0, NULL, NULL, ?
       FROM chat_conversations c;`,
      [new Date().toISOString()],
    );

    // 历史版本可能在外键未生效时删除 conversation identity；这些运行时事实已无 consumer，
    // 必须在数据库边界修复，不能由备份层忽略 foreign_key_check。
    await repairConversationTurnForeignKeys(db);
  } catch (mErr) {
    throw new Error('迁移55：建立 conversation turn 协调表失败', { cause: mErr });
  }

  // 迁移56：删除 legacy 记忆链路数据结构。
  // 逐消息暂存（memory_events）、旧事实池（memories / memory_evidence / memory_overrides）、
  // 向量化（memory_embeddings）、三模式机器（memory_runtime_modes）与影子对比
  // （memory_shadow_comparisons）随旧提取/召回链路一并废弃；已发布 migration 不改写，
  // 统一在此 DROP。记忆条目溯源（memory_entry_sources）改指聊天消息的小 id / 大 id：
  // 仅当检测到旧 event_id 结构时重建一次，之后每次启动只做幂等修补，不再清表。
  try {
    await db.execAsync(`
      DROP TABLE IF EXISTS memory_shadow_comparisons;
      DROP TABLE IF EXISTS memory_runtime_modes;
      DROP TABLE IF EXISTS memory_embeddings;
      DROP TABLE IF EXISTS memory_evidence;
      DROP TABLE IF EXISTS memory_overrides;
      DROP TABLE IF EXISTS memories;
      DROP TABLE IF EXISTS memory_events;
    `);

    const entrySourceColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('memory_entry_sources')`
    );
    if (entrySourceColumns.some((column) => column.name === 'event_id')) {
      // 旧事件溯源结构：当前无运行时读写方，直接 DROP 换新结构。
      await db.execAsync(`DROP TABLE memory_entry_sources;`);
    }
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS memory_entry_sources (
        entry_id TEXT NOT NULL,
        message_id INTEGER,
        logical_message_id TEXT,
        source_role TEXT NOT NULL DEFAULT 'origin',
        PRIMARY KEY (entry_id, message_id, logical_message_id),
        CHECK (message_id IS NOT NULL OR logical_message_id IS NOT NULL),
        FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_entry_sources_message
        ON memory_entry_sources(message_id, entry_id);
      CREATE INDEX IF NOT EXISTS idx_memory_entry_sources_logical_message
        ON memory_entry_sources(logical_message_id, entry_id);

      ${modelSelectionsMigrated ? '' : `DELETE FROM capability_bindings WHERE capability_kind = 'extractor';
      DELETE FROM assistant_capability_bindings WHERE capability_kind = 'extractor';`}
      DELETE FROM auxiliary_model_configs WHERE capability_kind = 'extractor';
    `);
  } catch (mErr) {
    throw new Error('迁移56：删除 legacy 记忆链路数据结构失败', { cause: mErr });
  }

  // 迁移57：为群聊召唤建立每群单活动计划约束。
  // 历史竞态可能已经留下多个 pending/running 行；保留最新行，其余终止后再建唯一索引。
  try {
    const now = new Date().toISOString();
    await db.runAsync(
      `WITH ranked AS (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY group_id
                  ORDER BY created_at DESC, updated_at DESC, id DESC
                ) AS plan_rank
         FROM group_speech_plans
         WHERE status IN ('pending', 'running')
       )
       UPDATE group_speech_plans
       SET status = 'failed',
           completed_at = COALESCE(completed_at, ?),
           error_message = COALESCE(error_message, '由于重复群聊召唤，旧计划已终止'),
           updated_at = ?
       WHERE id IN (SELECT id FROM ranked WHERE plan_rank > 1);`,
      [now, now],
    );
    await db.execAsync(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_group_speech_plans_single_active
       ON group_speech_plans(group_id)
       WHERE status IN ('pending', 'running');`,
    );
  } catch (mErr) {
    throw new Error('迁移57：建立群聊召唤单活动计划约束失败', { cause: mErr });
  }

  // 迁移58：群管理员上下文数量由群配置持久化，0 表示不读取历史消息。
  try {
    const adminConfigColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('group_chat_admin_configs')`,
    );
    if (!adminConfigColumns.some((column) => column.name === 'context_message_count')) {
      await db.execAsync(`
        ALTER TABLE group_chat_admin_configs
        ADD COLUMN context_message_count INTEGER NOT NULL DEFAULT 20
          CHECK (context_message_count BETWEEN 0 AND 100);
      `);
    }
  } catch (mErr) {
    throw new Error('迁移58：持久化群管理员上下文数量失败', { cause: mErr });
  }

  // 迁移59：以 Assistant 身份 owner 为准修正当前群成员 actor key 快照。
  // 历史消息和发言任务记录的是事实发生时的归因，本迁移不回写。
  try {
    await migrateAssistantIdentityContract(db);
  } catch (mErr) {
    throw new Error('迁移59：校正群成员 Assistant 身份快照失败', { cause: mErr });
  }

  // 迁移60：将旧的用户 @ AI 快照升级为统一 actor/target 判别联合。
  try {
    await migrateGroupMentionMetadata(db);
  } catch (mErr) {
    throw new Error('迁移60：升级群聊 mention metadata 失败', { cause: mErr });
  }

  // 迁移61：群发言任务来源拆分为 user_mention / ai_mention / admin /
  // inherited_after_user_interrupt；历史 'mention' 行全部来自用户 @，统一升级。
  try {
    await db.runAsync(
      `UPDATE group_speech_tasks SET source = 'user_mention' WHERE source = 'mention';`,
    );
  } catch (mErr) {
    throw new Error('迁移61：拆分群发言任务来源失败', { cause: mErr });
  }

  // 迁移62：用户消息换代 plan。group_speech_plans.supersedes_plan_id 标记 pending
  // successor 的输入窗口归属（非空即"换代产生的 successor"，用于区分 fresh claim 的
  // 瞬时 pending）；group_speech_tasks.visible_reply_committed 记录 running 任务是否
  // 已提交过可见回复，供换代事务决定该成员是否进入继承队列。
  try {
    const planColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('group_speech_plans')`,
    );
    if (!planColumns.some((column) => column.name === 'supersedes_plan_id')) {
      await db.execAsync(`
        ALTER TABLE group_speech_plans
        ADD COLUMN supersedes_plan_id TEXT;
      `);
    }
    const taskColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('group_speech_tasks')`,
    );
    if (!taskColumns.some((column) => column.name === 'visible_reply_committed')) {
      await db.execAsync(`
        ALTER TABLE group_speech_tasks
        ADD COLUMN visible_reply_committed INTEGER NOT NULL DEFAULT 0;
      `);
    }
  } catch (mErr) {
    throw new Error('迁移62：扩展群发言 plan 换代事实失败', { cause: mErr });
  }

  // 迁移63：群发言 plan 增加 preparing 状态（召唤已接管、输入窗口已关闭），
  // 单活动唯一索引随之覆盖 preparing，防止规划期间被并发 claim 出第二个活动
  // plan；group_chats.last_message_id 把 preview 绑定到具体消息事实，供 commit
  // 后的晚到 preview 副作用按消息 ID 做 CAS。
  try {
    await db.execAsync(`
      DROP INDEX IF EXISTS idx_group_speech_plans_single_active;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_group_speech_plans_single_active
        ON group_speech_plans(group_id)
        WHERE status IN ('pending', 'preparing', 'running');
    `);
    const groupChatColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('group_chats')`,
    );
    if (!groupChatColumns.some((column) => column.name === 'last_message_id')) {
      await db.execAsync(`
        ALTER TABLE group_chats
        ADD COLUMN last_message_id INTEGER;
      `);
    }
  } catch (mErr) {
    throw new Error('迁移63：群发言 preparing 状态与群预览消息绑定失败', { cause: mErr });
  }

  // 迁移64：ai_assistants 表新增上下文可见条数（主客动态装载）四个配置列。
  // 默认值与 @shared/prompt 的 DEFAULT_*_CONTEXT_*_LIMIT 兜底常量保持一致。
  try {
    const assistantColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('ai_assistants')`,
    );
    const assistantColumnNames = new Set(assistantColumns.map((column) => column.name));
    if (!assistantColumnNames.has('private_context_primary_limit')) {
      await db.execAsync(`
        ALTER TABLE ai_assistants
        ADD COLUMN private_context_primary_limit INTEGER NOT NULL DEFAULT 30;
      `);
    }
    if (!assistantColumnNames.has('private_context_secondary_limit')) {
      await db.execAsync(`
        ALTER TABLE ai_assistants
        ADD COLUMN private_context_secondary_limit INTEGER NOT NULL DEFAULT 10;
      `);
    }
    if (!assistantColumnNames.has('group_context_primary_limit')) {
      await db.execAsync(`
        ALTER TABLE ai_assistants
        ADD COLUMN group_context_primary_limit INTEGER NOT NULL DEFAULT 40;
      `);
    }
    if (!assistantColumnNames.has('group_context_secondary_limit')) {
      await db.execAsync(`
        ALTER TABLE ai_assistants
        ADD COLUMN group_context_secondary_limit INTEGER NOT NULL DEFAULT 5;
      `);
    }
  } catch (mErr) {
    throw new Error('迁移64：新增 AI 上下文可见条数配置列失败', { cause: mErr });
  }

  // 迁移65：MCP Server 增加供 AI 了解服务用途的可选简介。
  // 简介由 MCP 配置应用层限制长度；数据库只负责保证列存在且不可为 NULL。
  try {
    const mcpServerColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('mcp_servers')`,
    );
    if (!mcpServerColumns.some((column) => column.name === 'description')) {
      await db.execAsync(`
        ALTER TABLE mcp_servers
        ADD COLUMN description TEXT NOT NULL DEFAULT '';
      `);
    }
  } catch (mErr) {
    throw new Error('迁移65：MCP Server 简介字段迁移失败', { cause: mErr });
  }

  // 迁移66：把旧的传输形态命名收敛为 MCP 官方协议时代命名。
  // 物理列名保留以避免无意义的表重建；其值从此表达 legacy / modern era。
  // 快照由本应用 JSON.stringify 产生，键名与字面量格式是既有持久化契约。
  try {
    await db.execAsync(`
      UPDATE mcp_servers
      SET last_protocol_family = CASE last_protocol_family
        WHEN 'stateful_2025' THEN 'legacy'
        WHEN 'stateless_2026' THEN 'modern'
        ELSE last_protocol_family
      END;

      UPDATE mcp_servers
      SET tool_snapshot_json = REPLACE(
        REPLACE(
          tool_snapshot_json,
          '"protocolFamily":"stateful_2025"',
          '"protocolEra":"legacy"'
        ),
        '"protocolFamily":"stateless_2026"',
        '"protocolEra":"modern"'
      )
      WHERE tool_snapshot_json LIKE '%"protocolFamily"%';
    `);
  } catch (mErr) {
    throw new Error('迁移66：MCP 协议时代命名迁移失败', { cause: mErr });
  }

  // 迁移67：建立 MediaAsset catalog。这里只创建新表与普通 Hash 候选索引，
  // 不读取或改写任何 legacy URI；现有业务引用迁移属于后续 M3。
  try {
    await db.execAsync(MEDIA_ASSET_SCHEMA);
    await db.execAsync(MEDIA_ASSET_CONTENT_HASH_INDEX);
  } catch (mErr) {
    throw new Error('迁移67：建立 MediaAsset catalog 失败', { cause: mErr });
  }

  // 迁移68：M3b 为当前用户、AI、群头像增加 nullable canonical asset 引用。
  // 这里只建立列，不读取或改写 avatar legacy URI；原子 adoption 由各 owner
  // repository 与 Host maintenance 组合完成。
  try {
    const avatarOwnerTables = ['user_profile', 'ai_assistants', 'group_chats'] as const;
    for (const table of avatarOwnerTables) {
      const columns = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info('${table}')`,
      );
      if (!columns.some((column) => column.name === 'avatar_media_asset_id')) {
        await db.execAsync(
          `ALTER TABLE ${table} ADD COLUMN avatar_media_asset_id TEXT;`,
        );
      }
    }
  } catch (mErr) {
    throw new Error('迁移68：头像 canonical MediaAsset 引用列迁移失败', { cause: mErr });
  }

  // 迁移69：建立 RavenCat Device Control Soft App Lock 业务真值表。
  // 业务状态（active/released/expired/failed）是唯一真值；本表不保存 native overlay
  // 的 attached 等运行时投影状态，投影由 application 在业务提交后 reconcile 下发。
  try {
    await db.execAsync(RAVEN_CAT_SOFT_APP_LOCKS_SCHEMA);
    await db.execAsync(RAVEN_CAT_SOFT_APP_LOCKS_STATUS_INDEX);
    await db.execAsync(RAVEN_CAT_SOFT_APP_LOCKS_AI_ACTIVE_TARGET_INDEX);
  } catch (mErr) {
    throw new Error('迁移69：建立 RavenCat Soft App Lock 业务真值表失败', { cause: mErr });
  }

  // 迁移70：悬浮交互拥有独立用户意图，不再复用主动伴随的启停状态。
  try {
    await db.execAsync(RAVEN_CAT_FLOATING_INTERACTION_SETTINGS_SCHEMA);
  } catch (mErr) {
    throw new Error('迁移70：建立 RavenCat 悬浮交互设置失败', { cause: mErr });
  }

  // 迁移71：退役每日队列、联系尝试账本及其额度字段。
  // ContactTrace 继续保存可审计事实；设置和状态表只保留仍有运行时 owner 的列。
  try {
    const contactSettingsColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('raven_cat_contact_settings')`,
    );
    const contactSettingsColumnNames = new Set(
      contactSettingsColumns.map((column) => column.name),
    );
    const companionStateColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('raven_cat_companion_state')`,
    );
    const companionStateColumnNames = new Set(
      companionStateColumns.map((column) => column.name),
    );
    const shouldRebuildContactSettings = [
      'settings_revision',
      'global_contact_points',
      'last_point_recovery_at',
      'daily_contact_limit',
    ].some((column) => contactSettingsColumnNames.has(column));
    const shouldDropContactSettingsLegacyColumns =
      contactSettingsColumnNames.has('proactive_contact_enabled') ||
      contactSettingsColumnNames.has('screen_capture_app_blacklist_json') ||
      contactSettingsColumnNames.has('screen_capture_unobstructed_mode_enabled') ||
      contactSettingsColumnNames.has('screen_capture_retention_policy');
    const shouldRebuildCompanionState = [
      'activation_revision',
      'quota_window_id',
      'quota_day_key',
      'quota_reset_at',
      'recovery_wake_at',
      'active_attempt_id',
      'last_plan_succeeded_at',
    ].some((column) => companionStateColumnNames.has(column));

    await db.execAsync('PRAGMA foreign_keys = OFF;');
    await db.execAsync('BEGIN;');
    await db.execAsync(`
      DROP TABLE IF EXISTS raven_cat_queue_slots;
      DROP TABLE IF EXISTS raven_cat_daily_queues;
      DROP TABLE IF EXISTS raven_cat_contact_attempts;
      DROP TABLE IF EXISTS raven_cat_companion_migration_state;
    `);

    // 迁移71a：把旧 screen_capture_app_blacklist_json 中的用户自定义包名合并到
    // user_screen_capture_blacklist_json，避免清理字段时丢失用户黑名单。
    // 系统保护包始终由应用重新注入，不应写回用户字段。
    if (contactSettingsColumnNames.has('screen_capture_app_blacklist_json')) {
      const protectedPackages = new Set<string>([
        'com.android.settings',
        'com.android.permissioncontroller',
        'com.google.android.permissioncontroller',
      ]);
      const rows = await db.getAllAsync<{
        id: string;
        screen_capture_app_blacklist_json: string;
        user_screen_capture_blacklist_json?: string;
      }>(`
        SELECT id, screen_capture_app_blacklist_json, user_screen_capture_blacklist_json
        FROM raven_cat_contact_settings
      `);
      for (const row of rows) {
        const parsePackageList = (json: string | undefined): string[] => {
          try {
            const parsed: unknown = JSON.parse(json || '[]');
            if (!Array.isArray(parsed)) return [];
            return parsed.filter((item): item is string => typeof item === 'string');
          } catch {
            return [];
          }
        };
        const oldPackages = parsePackageList(row.screen_capture_app_blacklist_json)
          .filter((pkg) => !protectedPackages.has(pkg));
        const existingPackages = parsePackageList(row.user_screen_capture_blacklist_json);
        const merged = new Set([...existingPackages, ...oldPackages]);
        const mergedJson = JSON.stringify([...merged].sort());
        await db.runAsync(
          `UPDATE raven_cat_contact_settings
           SET user_screen_capture_blacklist_json = ?
           WHERE id = ?`,
          [mergedJson, row.id],
        );
      }
    }

    if (shouldRebuildContactSettings || shouldDropContactSettingsLegacyColumns) {
      const quietHoursEnabledExpression = contactSettingsColumnNames.has('quiet_hours_enabled')
        ? 'quiet_hours_enabled'
        : '1';
      await db.execAsync(`
        CREATE TABLE raven_cat_contact_settings_new (
          id TEXT PRIMARY KEY,
          enabled_message_route INTEGER NOT NULL DEFAULT 1,
          enabled_screen_then_message_route INTEGER NOT NULL DEFAULT 0,
          enabled_video_call_route INTEGER NOT NULL DEFAULT 1,
          quiet_hours_enabled INTEGER NOT NULL DEFAULT 1
            CHECK (quiet_hours_enabled IN (0, 1)),
          quiet_hours_start_minutes INTEGER NOT NULL DEFAULT 1380
            CHECK (quiet_hours_start_minutes BETWEEN 0 AND 1439),
          quiet_hours_end_minutes INTEGER NOT NULL DEFAULT 480
            CHECK (quiet_hours_end_minutes BETWEEN 0 AND 1439),
          user_screen_capture_blacklist_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO raven_cat_contact_settings_new (
          id, enabled_message_route,
          enabled_screen_then_message_route, enabled_video_call_route,
          quiet_hours_enabled, quiet_hours_start_minutes,
          quiet_hours_end_minutes, user_screen_capture_blacklist_json,
          created_at, updated_at
        )
        SELECT id, enabled_message_route,
          enabled_screen_then_message_route, enabled_video_call_route,
          ${quietHoursEnabledExpression}, quiet_hours_start_minutes,
          quiet_hours_end_minutes, user_screen_capture_blacklist_json,
          created_at, updated_at
        FROM raven_cat_contact_settings;

        DROP TABLE raven_cat_contact_settings;
        ALTER TABLE raven_cat_contact_settings_new
          RENAME TO raven_cat_contact_settings;
      `);
    }

    if (shouldRebuildCompanionState) {
      // 71 的目标结构含 wake-plan / legacy wake 列，但进入 71 的 source schema 可能是多种
      // 历史形态：wake-plan 五列由迁移46 ALTER 添加，next_wake_at / next_wake_source 由
      // 迁移72b 退役。全历史对这张表只有迁移46 一处 ADD COLUMN，所以除核心九列外，
      // 只有这七列可能缺失 —— 这里按实际列集生成 SELECT，缺列落 NULL，
      // 使 rebuild 对任何合法历史 shape 都能正规化，而不是 no such column 硬失败。
      const companionStateSourceColumns = new Set(
        (
          await db.getAllAsync<{ name: string }>(
            `PRAGMA table_info('raven_cat_companion_state')`,
          )
        ).map((column) => column.name),
      );
      const sourceColumn = (columnName: string): string => (
        companionStateSourceColumns.has(columnName)
          ? `source.${columnName}`
          : 'NULL'
      );
      const copiedWakeExpressions = [
        sourceColumn('desired_wake_at'),
        sourceColumn('continuity_deadline'),
        `COALESCE(${sourceColumn('effective_wake_at')}, ${sourceColumn('next_wake_at')})`,
        sourceColumn('wake_intent_summary'),
        companionStateSourceColumns.has('wake_adjustment_reason')
          ? `CASE source.wake_adjustment_reason WHEN 'quiet_hours' THEN 'quiet_hours' ELSE NULL END`
          : 'NULL',
        `COALESCE(${sourceColumn('effective_wake_at')}, ${sourceColumn('next_wake_at')})`,
        companionStateSourceColumns.has('next_wake_source')
          ? `CASE
               WHEN source.next_wake_source IN (
                 'ai_wake', 'chat_tool', 'continuity_guard', 'quiet_hours_adjustment'
               ) THEN source.next_wake_source
               ELSE NULL
             END`
          : 'NULL',
      ].join(',\n            ');

      await db.execAsync(`
        CREATE TABLE raven_cat_companion_state_new (
          id TEXT PRIMARY KEY,
          desired_enabled INTEGER NOT NULL DEFAULT 0
            CHECK (desired_enabled IN (0, 1)),
          activation_status TEXT NOT NULL DEFAULT 'disabled'
            CHECK (activation_status IN ('disabled', 'enabling', 'enabled', 'paused_error', 'disabling')),
          schedule_revision INTEGER NOT NULL DEFAULT 0
            CHECK (schedule_revision >= 0),
          host_ai_id TEXT,
          desired_wake_at TEXT,
          continuity_deadline TEXT,
          effective_wake_at TEXT,
          wake_intent_summary TEXT,
          wake_adjustment_reason TEXT,
          next_wake_at TEXT,
          next_wake_source TEXT,
          last_failure_code TEXT,
          last_failure_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (host_ai_id) REFERENCES ai_assistants(id) ON DELETE SET NULL
        );

        INSERT INTO raven_cat_companion_state_new (
          id, desired_enabled, activation_status, schedule_revision,
          host_ai_id, desired_wake_at, continuity_deadline,
          effective_wake_at, wake_intent_summary, wake_adjustment_reason,
          next_wake_at, next_wake_source, last_failure_code,
          last_failure_at, created_at, updated_at
        )
        SELECT source.id, source.desired_enabled, source.activation_status,
          source.schedule_revision, source.host_ai_id,
            ${copiedWakeExpressions},
          source.last_failure_code, source.last_failure_at,
          source.created_at, source.updated_at
        FROM raven_cat_companion_state AS source;

        DROP TABLE raven_cat_companion_state;
        ALTER TABLE raven_cat_companion_state_new
          RENAME TO raven_cat_companion_state;
      `);
    }

    await db.execAsync('COMMIT;');
    await db.execAsync('PRAGMA foreign_keys = ON;');
  } catch (mErr) {
    try {
      await db.execAsync('ROLLBACK;');
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }
    throw new Error('迁移71：退役 RavenCat 每日队列与额度存储失败', { cause: mErr });
  }

  // 迁移72b：旧 wake 单值没有稳定 identity，只删除列并保留生命周期事实，
  // 不生成任何新的 scheduled Self Wake。
  try {
    await migrateRavenCatCompanionStateWakeColumns(db);
  } catch (mErr) {
    throw new Error('迁移72b：退役 CompanionState wake 单值列失败', { cause: mErr });
  }

  // 迁移73：退役 legacy ContactTrace 物理存储。历史迁移 31/39/45/46 仍会在同一次
  // bootstrap 中重新创建/扩展 raven_cat_contact_traces，因此必须在全部历史迁移之后
  // 用幂等的 DROP TABLE IF EXISTS 收敛到最终无表状态；该表的 indexes 随表一并删除。
  try {
    await db.execAsync(`DROP TABLE IF EXISTS raven_cat_contact_traces;`);
  } catch (mErr) {
    throw new Error('迁移73：退役 legacy ContactTrace 物理存储失败', { cause: mErr });
  }

  // 迁移74：退役 legacy contact route columns。固定 contact route runtime 已完全退役，
  // 三条 route columns（enabled_message_route / enabled_screen_then_message_route /
  // enabled_video_call_route）不再有 production consumer；把 existing 表收敛为
  // live-only table，仅保留 CompanionSettings 仍拥有的列，并原样保留 live 数据。
  try {
    const contactSettingsColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('raven_cat_contact_settings')`,
    );
    const contactSettingsColumnNames = new Set(
      contactSettingsColumns.map((column) => column.name),
    );
    const hasDeadRouteColumn = [
      'enabled_message_route',
      'enabled_screen_then_message_route',
      'enabled_video_call_route',
    ].some((column) => contactSettingsColumnNames.has(column));

    if (hasDeadRouteColumn) {
      await db.execAsync('PRAGMA foreign_keys = OFF;');
      await db.execAsync('BEGIN;');
      await db.execAsync(`
        CREATE TABLE raven_cat_contact_settings_new (
          id TEXT PRIMARY KEY,
          quiet_hours_enabled INTEGER NOT NULL DEFAULT 1
            CHECK (quiet_hours_enabled IN (0, 1)),
          quiet_hours_start_minutes INTEGER NOT NULL DEFAULT 1380
            CHECK (quiet_hours_start_minutes BETWEEN 0 AND 1439),
          quiet_hours_end_minutes INTEGER NOT NULL DEFAULT 480
            CHECK (quiet_hours_end_minutes BETWEEN 0 AND 1439),
          user_screen_capture_blacklist_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO raven_cat_contact_settings_new (
          id, quiet_hours_enabled, quiet_hours_start_minutes,
          quiet_hours_end_minutes, user_screen_capture_blacklist_json,
          created_at, updated_at
        )
        SELECT id, quiet_hours_enabled, quiet_hours_start_minutes,
          quiet_hours_end_minutes, user_screen_capture_blacklist_json,
          created_at, updated_at
        FROM raven_cat_contact_settings;

        DROP TABLE raven_cat_contact_settings;
        ALTER TABLE raven_cat_contact_settings_new
          RENAME TO raven_cat_contact_settings;
      `);
      await db.execAsync('COMMIT;');
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }
  } catch (mErr) {
    try {
      await db.execAsync('ROLLBACK;');
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }
    throw new Error('迁移74：退役 legacy contact route columns 失败', { cause: mErr });
  }

  // 迁移75：归档并退役 legacy raven_cat_proactive user prompt rows。
  // 旧升级库的 assistant_user_prompts 可能仍使用允许 raven_cat_proactive 的旧 CHECK，
  // 且保存着 condition = 'raven_cat_proactive' 的旧 user prompt row。
  // 本迁移先把 legacy row 无损归档到 assistant_user_prompt_archive（离开 active table 即 inert，
  // 不篡改原 enabled/正文），再把 active table 收敛为当前 fresh CHECK；正常 prompt 原样保留。
  try {
    // 确保 archive table 与 index 存在（PROMPTING_SCHEMA 幂等，不影响已收敛的 active table）。
    await db.execAsync(PROMPTING_SCHEMA);

    // A. 无损归档所有 legacy row；source_prompt_id 主键 + INSERT OR IGNORE 保证幂等，
    //    重复 bootstrap 不会重复归档，也不改原 enabled。
    await db.execAsync(`
      INSERT OR IGNORE INTO assistant_user_prompt_archive (
        source_prompt_id, assistant_id, name, content,
        original_condition, original_enabled, original_sort_order,
        original_created_at, original_updated_at,
        archive_reason, archived_at
      )
      SELECT
        id, assistant_id, name, content,
        condition, enabled, sort_order,
        created_at, updated_at,
        'retired_raven_cat_proactive_condition', CURRENT_TIMESTAMP
      FROM assistant_user_prompts
      WHERE condition = 'raven_cat_proactive';
    `);

    // B. 判定 active table 是否仍为 legacy schema：以 sqlite_master 的真实 CREATE TABLE SQL
    //    为准，并兜底检查是否仍存在 legacy row。
    const createSqlRow = await db.getFirstAsync<{ sql: string }>(
      `SELECT sql FROM sqlite_master
       WHERE type = 'table' AND name = 'assistant_user_prompts'`,
    );
    const legacyRow = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM assistant_user_prompts
       WHERE condition = 'raven_cat_proactive'`,
    );
    const isLegacySchema = (createSqlRow?.sql ?? '').includes('raven_cat_proactive');
    const hasLegacyRow = (legacyRow?.count ?? 0) > 0;

    if (isLegacySchema || hasLegacyRow) {
      // C. rebuild active table 到当前 fresh shape，只复制 condition <> 'raven_cat_proactive'
      //    的正常行；legacy row 已归档，重建后彻底离开 active table。
      await db.execAsync('PRAGMA foreign_keys = OFF;');
      await db.execAsync('BEGIN;');
      await db.execAsync(`
        CREATE TABLE assistant_user_prompts_new (
          id TEXT PRIMARY KEY,
          assistant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          content TEXT NOT NULL,
          condition TEXT NOT NULL DEFAULT 'always'
            CHECK (condition IN ('always', 'private_chat', 'group_chat', 'call', 'moments', 'image_present', 'tools_enabled')),
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          sort_order INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (assistant_id) REFERENCES ai_assistants(id) ON DELETE CASCADE
        );

        INSERT INTO assistant_user_prompts_new (
          id, assistant_id, name, content, condition, enabled, sort_order, created_at, updated_at
        )
        SELECT id, assistant_id, name, content, condition, enabled, sort_order, created_at, updated_at
        FROM assistant_user_prompts
        WHERE condition <> 'raven_cat_proactive';

        DROP TABLE assistant_user_prompts;
        ALTER TABLE assistant_user_prompts_new RENAME TO assistant_user_prompts;

        -- DROP 旧表会连带删除其 index；rebuild 后必须显式恢复，保持与 fresh schema 一致。
        CREATE INDEX IF NOT EXISTS idx_assistant_user_prompts_order
          ON assistant_user_prompts(assistant_id, condition, sort_order, id);
      `);
      await db.execAsync('COMMIT;');
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }
  } catch (mErr) {
    try {
      await db.execAsync('ROLLBACK;');
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }
    throw new Error('迁移75：归档并退役 legacy proactive user prompt 失败', { cause: mErr });
  }

  // 迁移76：建立 Together Listening Activity 产品真值与全局唯一 non-terminal 约束。
  // 不建立指向 AI / Chat 的外键，确保参与者或会话删除后历史 Activity identity 仍被保留。
  try {
    await migrateTogetherListeningActivity(db);
  } catch (mErr) {
    throw new Error('迁移76：建立 Together Listening Activity 真值失败', { cause: mErr });
  }

  // 迁移78：建立 AI 日程持久真值与范围查询索引。
  // owner identity 不随主理关系变更迁移；本迁移不建立任何 Android projection。
  try {
    await db.execAsync(RAVEN_CAT_AI_SCHEDULES_SCHEMA);
    await db.execAsync(RAVEN_CAT_AI_SCHEDULES_OWNER_STATUS_TIME_INDEX);
    await db.execAsync(RAVEN_CAT_AI_SCHEDULES_OWNER_TIME_INDEX);
  } catch (mErr) {
    throw new Error('迁移78：建立 RavenCat AI Schedule 持久真值失败', { cause: mErr });
  }

  // 迁移79：为 AI Schedule 增加系统级 authority invalidation 终态原因列。
  // 用户 / AI cancel 保持 NULL；只有 owner 不再是当前主理 AI 时记录 'owner_revoked'。
  try {
    const scheduleColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('raven_cat_ai_schedules')`,
    );
    const hasCancelledReason = (scheduleColumns || []).some(
      (column) => column.name === 'cancelled_reason',
    );
    if (!hasCancelledReason) {
      await db.execAsync(
        `ALTER TABLE raven_cat_ai_schedules ADD COLUMN cancelled_reason TEXT`,
      );
    }
  } catch (mErr) {
    throw new Error('迁移79：为 AI Schedule 增加 authority invalidation 终态原因失败', {
      cause: mErr,
    });
  }

  // 迁移80：历史版本曾按 terminal timestamp 建立 keyset 索引；迁移83 会把
  // 产品时间轴收敛到 occurredAt（claimed_at）。这里保留已发布迁移的原始步骤。
  try {
    await db.execAsync(RAVEN_CAT_AI_SCHEDULES_CONSUMED_HISTORY_INDEX);
  } catch (mErr) {
    throw new Error('迁移80：建立 RavenCat AI Schedule 历史索引失败', { cause: mErr });
  }

  // 迁移81：建立 Sticker 收藏库、分组、结构化标注队列及查询索引。
  // 媒体字节仍由既有 MediaAsset catalog 持有，本迁移不扫描或改写任何文件。
  try {
    await db.execAsync(STICKER_SCHEMA);
  } catch (mErr) {
    throw new Error('迁移81：建立 Sticker 收藏库与标注队列失败', { cause: mErr });
  }

  // 迁移82：语音播放状态属于 Chat message，不复用会话 is_read。
  try {
    const messageColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('messages')`,
    );
    if (!messageColumns.some((column) => column.name === 'voice_played_at')) {
      await db.execAsync(`ALTER TABLE messages ADD COLUMN voice_played_at TEXT;`);
    }
  } catch (mErr) {
    throw new Error('迁移82：增加 Chat 语音播放状态失败', { cause: mErr });
  }

  // 迁移83：AI Schedule consumed 记录同时提交执行 disposition；历史排序统一使用
  // claimed_at（机会实际发生时间）。旧表必须重建到 latest shape，不能只 ADD COLUMN，
  // 否则升级库缺少 status + completion_disposition 的跨列 CHECK。
  try {
    await migrateRavenCatAISchedulesCompletionDisposition(db);
  } catch (mErr) {
    throw new Error('迁移83：增加 AI Schedule 执行 disposition 与 occurredAt 历史索引失败', {
      cause: mErr,
    });
  }

  // 迁移84：Sticker System V2。补齐 stickers.semantic_revision、业务级模型绑定表
  // 与向量索引表；同时清理已删除的 sticker_annotation capability 的旧 binding /
  // model config 记录，避免数据库长期保留不再属于有效 CapabilityKind 的数据。
  // 不访问网络；现有 ready Sticker 的向量由 App 启动后的 embedding worker backfill。
  try {
    const stickerColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('stickers')`,
    );
    if (!stickerColumns.some((column) => column.name === 'semantic_revision')) {
      await db.execAsync(
        `ALTER TABLE stickers ADD COLUMN semantic_revision INTEGER NOT NULL DEFAULT 1 CHECK (semantic_revision >= 1)`,
      );
    }
    await db.execAsync(STICKER_V2_SCHEMA);

    if (!modelSelectionsMigrated) {
      // 顺序先 binding、后 model config；sticker_annotation 不做任何配置迁移或 adoption。
      await db.runAsync(
        `DELETE FROM assistant_capability_bindings WHERE capability_kind = 'sticker_annotation'`,
      );
      await db.runAsync(
        `DELETE FROM capability_bindings WHERE capability_kind = 'sticker_annotation'`,
      );
    }
    await db.runAsync(
      `DELETE FROM auxiliary_model_configs WHERE capability_kind = 'sticker_annotation'`,
    );
  } catch (mErr) {
    throw new Error('迁移84：建立 Sticker System V2 配置与向量索引并清理旧 capability 失败', {
      cause: mErr,
    });
  }

  // 迁移85：单聊收敛为每个 AI 唯一 canonical conversation，并建立非破坏式历史边界。
  //
  // legacy 库里有三种需要收口的 direct session，缺一都会让最后的
  // `CREATE UNIQUE INDEX ON sessions(ai_assistant_id)` 撞 UNIQUE：
  //   1. alternate：同一现存 AI 的多个 session（只保留 canonical）；
  //   2. orphan：owner 已不在 ai_assistants 的 session（ai_assistant_id 是已删除 AI 的 id）；
  //   3. orphan：ai_assistant_id 为 NULL / '' 的 session。
  // sessions 是 direct-chat detail 表，group chat 只存在于 group_chats + kind='group' identity，
  // 因此本迁移只按 sessions 行集合收口，group 事实不参与。
  try {
    // 每个阶段单独执行并带阶段名：真机升级失败时必须能从错误里读到是哪条 SQL，
    // 不能只留一个"迁移85失败"的黑盒（上一次真实排查就是卡在这里）。
    const runStage = async (stage: string, sql: string): Promise<void> => {
      try {
        await db.execAsync(sql);
      } catch (stageError) {
        throw new Error(`迁移85：${stage}`, { cause: stageError });
      }
    };

    const sessionColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('sessions')`,
    );
    if (!sessionColumns.some((column) => column.name === 'visible_after_message_id')) {
      await runStage(
        '补建 visible_after_message_id 列',
        `ALTER TABLE sessions ADD COLUMN visible_after_message_id INTEGER;`,
      );
    }

    // 整体原子：中途失败必须回滚，不能留下"删了一半 + 没建索引"的中间态。
    await db.execAsync('BEGIN;');
    try {
      await runStage('建立 canonical / alternate / orphan 临时集合', `
        DROP TABLE IF EXISTS canonical_direct_sessions;
        DROP TABLE IF EXISTS alternate_direct_sessions;
        DROP TABLE IF EXISTS orphan_direct_sessions;

        CREATE TEMP TABLE canonical_direct_sessions AS
        SELECT ranked.ai_id AS ai_id, ranked.session_id AS canonical_id
        FROM (
          SELECT s.ai_assistant_id AS ai_id,
                 s.id AS session_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY s.ai_assistant_id
                   ORDER BY CASE WHEN s.id = a.last_active_session_id THEN 0 ELSE 1 END,
                            s.is_active DESC,
                            s.updated_at DESC,
                            s.id DESC
                 ) AS canonical_rank
          FROM sessions s
          JOIN ai_assistants a ON a.id = s.ai_assistant_id
        ) ranked
        WHERE ranked.canonical_rank = 1;

        CREATE TEMP TABLE alternate_direct_sessions AS
        SELECT s.id
        FROM sessions s
        INNER JOIN canonical_direct_sessions c ON c.ai_id = s.ai_assistant_id
        WHERE c.canonical_id IS NOT NULL AND s.id <> c.canonical_id;

        CREATE TEMP TABLE orphan_direct_sessions AS
        SELECT s.id
        FROM sessions s
        WHERE s.ai_assistant_id IS NULL
           OR s.ai_assistant_id = ''
           OR NOT EXISTS (
             SELECT 1 FROM ai_assistants a WHERE a.id = s.ai_assistant_id
           );
      `);

      const removed = await db.getFirstAsync<{ alternates: number; orphans: number }>(
        `SELECT (SELECT COUNT(*) FROM alternate_direct_sessions) AS alternates,
                (SELECT COUNT(*) FROM orphan_direct_sessions) AS orphans`,
      );
      const alternates = removed?.alternates ?? 0;
      const orphans = removed?.orphans ?? 0;
      if (alternates > 0 || orphans > 0) {
        // 只在真的删了东西时提示一次；收口完成后这几张临时集合恒为空，不会每次启动刷屏。
        console.warn(
          `[persistence:sqlite.bootstrap] 迁移85：收口 legacy direct session —— ` +
            `alternate ${alternates} 条，orphan ${orphans} 条`,
        );
      }

      // legacy direct session 的完整清理，沿用既有级联语义，不自造 DELETE 顺序：
      // 先删 sessions 详情行（级联 call_sessions / call_events / session_vision_helpers），
      // 再删 kind='direct' 的 identity（级联 messages / conversation_turn_runs / turn_state）。
      await runStage('删除 legacy alternate / orphan direct session', `
        DELETE FROM sessions
        WHERE id IN (SELECT id FROM alternate_direct_sessions)
           OR id IN (SELECT id FROM orphan_direct_sessions);

        DELETE FROM chat_conversations
        WHERE kind = 'direct'
          AND id IN (SELECT id FROM alternate_direct_sessions
                     UNION
                     SELECT id FROM orphan_direct_sessions);
      `);

      await runStage('归一化 session 标记', `
        UPDATE sessions SET is_active = 1, is_archived = 0;
      `);

      await runStage('重写 last_active_session_id', `
        UPDATE ai_assistants
        SET last_active_session_id = (
          SELECT c.canonical_id
          FROM canonical_direct_sessions c
          WHERE c.ai_id = ai_assistants.id
        );
      `);

      await runStage('建立 canonical 唯一索引', `
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_canonical_ai
          ON sessions(ai_assistant_id);
      `);

      await runStage('清理临时集合', `
        DROP TABLE orphan_direct_sessions;
        DROP TABLE alternate_direct_sessions;
        DROP TABLE canonical_direct_sessions;
      `);

      await db.execAsync('COMMIT;');
    } catch (stageError) {
      await db.execAsync('ROLLBACK;').catch(() => undefined);
      throw stageError;
    }
  } catch (mErr) {
    throw new Error('迁移85：建立 canonical 单聊与历史边界失败', { cause: mErr });
  }

  // 迁移86：为清除聊天记录补一个事件级时间边界。
  // 迁移85 的 visible_after_message_id 只能表达 Chat Message 流的位置；
  // CallEvent 没有数值/单调 cursor（id 是带随机后缀的文本），因此 Call context
  // 需要独立的时间边界，才能让同一通跨 boundary 的电话后半段继续可见。
  try {
    const sessionColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('sessions')`,
    );
    if (!sessionColumns.some((column) => column.name === 'visible_after_at')) {
      await db.execAsync(`ALTER TABLE sessions ADD COLUMN visible_after_at TEXT;`);
    }
  } catch (mErr) {
    throw new Error('迁移86：补建历史清除时间边界失败', { cause: mErr });
  }

  // 迁移87：Moments V1 → V2。V1 的名称式身份、缺 created_at 的评论与
  // moment_ai_interactions 状态机无法映射到稳定身份，因此重建 Moments 自己的表并清理
  // V1 朋友圈数据；Chat / MediaAsset / assistant / profile 不受影响。
  try {
    await migrateMomentsV2(db);
  } catch (mErr) {
    throw new Error('迁移87：重建 Moments V2 表结构失败', { cause: mErr });
  }

  // 迁移88：辅助模型基础设施全局化 —— 把「是否视觉预处理」与「用哪个视觉模型」拆开。
  // 此历史阶段把 Embedding / STT / OCR 转为只读全局绑定；迁移95再将它们交给业务 owner。
  // 不再按 AI 绑定；AI 侧只保留图片处理策略 image_processing_mode。
  //
  // 这是一次性的 legacy → new 架构转换，判据为 ai_assistants 是否原本就有
  // image_processing_mode 列（fresh schema 自带该列，因此 fresh 库直接跳过）：
  // - 首次转换：从旧 OCR assistant binding 推导图片策略、裁决全局 OCR、清理旧行；
  // - 已转换：本段整体跳过，不得覆盖用户在新架构下自行设置的全局当前模型。
  //
  // 旧架构中 OCR runtime 明确忽略 global OCR binding（只认 assistant binding），
  // 因此历史 capability_bindings['ocr'] 是不生效的 stale 值，不能作为权威来源：
  // 首次转换时若无可靠的单一 legacy OCR 模型，必须把它清成未配置，防止复活。
  // 1) enabled 且填写了 model_config_id 的 OCR 绑定 = 用户「希望视觉预处理」的
  //    历史信号 → image_processing_mode = vision_preprocess（模型是否仍有效不影响该意图）；
  // 2) 所有有效绑定（引用模型存在、enabled、kind=ocr）指向同一个模型 → 采纳为全局当前模型；
  //    指向多个模型或没有有效绑定 → 全局 OCR 置为未配置（enabled=0、model_config_id=NULL，
  //    与 deleteAuxiliaryModelConfig 的清空约定一致），resolveCapabilityModel 返回 null；
  // 3) embedding / stt / ocr 的 assistant binding 行物理删除（TTS / memory_admin 保留）。
  try {
    const assistantColumns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info('ai_assistants')`,
    );
    const hadImageProcessingModeBeforeMigration = assistantColumns.some(
      (column) => column.name === 'image_processing_mode',
    );

    if (!modelSelectionsMigrated && !hadImageProcessingModeBeforeMigration) {
      // ALTER 与全部数据转换必须在同一显式事务内：否则「列已加、数据只迁一半」
      // 的失败窗口会让下次启动误判 migration88 已完成（列是幂等 marker），
      // 数据库永久停在半迁移状态。SQLite 支持事务内 DDL，失败整体回滚后
      // 下次启动仍看到列不存在，可完整重跑。
      await db.execAsync('BEGIN IMMEDIATE;');
      try {
        await db.execAsync(
          `ALTER TABLE ai_assistants ADD COLUMN image_processing_mode TEXT NOT NULL DEFAULT 'direct';`,
        );

        // legacy 状态读取也放进同一事务，保证裁决基于一致 snapshot。
        const validOcrBindingModelIds = await db.getAllAsync<{ model_config_id: string }>(
          `SELECT DISTINCT binding.model_config_id
           FROM assistant_capability_bindings binding
           JOIN auxiliary_model_configs config ON config.id = binding.model_config_id
           WHERE binding.capability_kind = 'ocr'
             AND binding.enabled = 1
             AND binding.model_config_id IS NOT NULL
             AND TRIM(binding.model_config_id) <> ''
             AND config.enabled = 1
             AND config.capability_kind = 'ocr'`,
        );

        // 全局 OCR 决策、AI 策略迁移、旧行清理三者必须同事务完成，禁止半套状态。
        if (validOcrBindingModelIds.length === 1) {
          await db.runAsync(
            `INSERT INTO capability_bindings (
               capability_kind, model_source, model_config_id, enabled, updated_at
             ) VALUES ('ocr', 'auxiliary_model', ?, 1, ?)
             ON CONFLICT(capability_kind)
             DO UPDATE SET
               model_source = 'auxiliary_model',
               model_config_id = excluded.model_config_id,
               enabled = 1,
               updated_at = excluded.updated_at`,
            [validOcrBindingModelIds[0].model_config_id, new Date().toISOString()],
          );
        } else {
          // 多模型（不武断选择）或无有效绑定（历史 global row 是 stale 值）：
          // 统一清成未配置，resolveCapabilityModel 必须返回 null。
          await db.runAsync(
            `INSERT INTO capability_bindings (
               capability_kind, model_source, model_config_id, enabled, updated_at
             ) VALUES ('ocr', 'auxiliary_model', NULL, 0, ?)
             ON CONFLICT(capability_kind)
             DO UPDATE SET
               model_config_id = NULL,
               enabled = 0,
               updated_at = excluded.updated_at`,
            [new Date().toISOString()],
          );
        }

        await db.runAsync(
          `UPDATE ai_assistants
           SET image_processing_mode = 'vision_preprocess',
               updated_at = ?
           WHERE id IN (
             SELECT binding.assistant_id
             FROM assistant_capability_bindings binding
             WHERE binding.capability_kind = 'ocr'
               AND binding.enabled = 1
               AND binding.model_config_id IS NOT NULL
               AND TRIM(binding.model_config_id) <> ''
           )`,
          [new Date().toISOString()],
        );

        await db.runAsync(
          `DELETE FROM assistant_capability_bindings
           WHERE capability_kind IN ('embedding', 'stt', 'ocr')`,
        );

        await db.execAsync('COMMIT;');
      } catch (stageError) {
        await db.execAsync('ROLLBACK;').catch(() => undefined);
        throw stageError;
      }
    }
  } catch (mErr) {
    throw new Error('迁移88：辅助模型全局化与图片处理策略迁移失败', { cause: mErr });
  }

  // 迁移89：会话列表置顶补独立的「最近置顶时刻」（sessions.pinned_at /
  // group_chats.pinned_at）。置顶是列表排序行为而非消息活动，不能用
  // last_time = now 制造假的聊天活跃。详见 conversationPinMigration.ts。
  try {
    await migrateConversationPinTimestamps(db);
  } catch (mErr) {
    throw new Error('迁移89：补齐会话置顶时刻列失败', { cause: mErr });
  }

  // 迁移90：在不重放 migration87 的前提下，为既有 V2 数据增加 all_except。
  // 只重建 moments 表的 CHECK constraint，comment / like / audience 事实全部保留。
  try {
    await migrateMomentsAudienceAllExcept(db);
  } catch (mErr) {
    throw new Error('迁移90：增加 Moments all_except 可见范围失败', { cause: mErr });
  }

  // 迁移91：新增空 Social Inbox schema；升级时不从历史 Moment/互动回填 delivery。
  try {
    await migrateMomentSocialInbox(db);
  } catch (mErr) {
    throw new Error('迁移91：增加 Moments Social Inbox 失败', { cause: mErr });
  }

  // 迁移92：新增空的 Moment Media 与 Moments Settings；不回填历史图片或封面。
  try {
    await migrateMomentMediaAndSettings(db);
  } catch (mErr) {
    throw new Error('迁移92：增加 Moment Media 与 Moments Settings 失败', { cause: mErr });
  }

  // 迁移93：数据保留型地增加 moments.location_label 与 Timeline keyset 排序索引。
  // 历史 Moment 保持 NULL；不重建整表，不重放 migration87/90/91/92 的历史语义。
  try {
    await migrateMomentLocationLabel(db);
  } catch (mErr) {
    throw new Error('迁移93：增加 Moment 地点列与 Timeline 排序索引失败', { cause: mErr });
  }

  // 迁移94：用户授权定向清旧记忆；新表名隔离历史重放，失败必须阻止新运行时启动。
  await migrateMemoryV3(db);
  await migrateChatSummary(db);

  // 迁移95：业务明确选择取代默认继承，事务内固化旧选择并退休绑定表。
  await migrateModelSelections(db);
  // 迁移96：视觉识别选择按角色保存，合并旧图片策略开关并删除全局选择。
  await migrateChatImageModelSelections(db);
  // 迁移97：只创建背景选择；文件准备与本机旧设置迁移由 Calls 负责。
  await db.execAsync(CALL_BACKGROUND_SELECTION_SCHEMA);
  // 迁移98：Profile 接管壁纸选择，旧本机 URI 由 owner 准备后迁移。
  await db.execAsync(WALLPAPER_SELECTION_SCHEMA);
  // 迁移99：只增加 Profile 封面身份；文件准备与旧值迁移在事务外完成。
  const coverColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('user_profile')");
  if (!coverColumns.some((column) => column.name === 'moments_cover_media_asset_id')) {
    await db.execAsync('ALTER TABLE user_profile ADD COLUMN moments_cover_media_asset_id TEXT');
  }
  if (!coverColumns.some((column) => column.name === 'moments_cover_revision')) {
    await db.execAsync('ALTER TABLE user_profile ADD COLUMN moments_cover_revision INTEGER NOT NULL DEFAULT 0');
  }
  // 迁移100：背景按角色绑定；SQLite 中的旧全局选择一次性分配，不保留全局继承。
  await migrateAssistantCallBackgrounds(db);
  // 迁移101：开发版100曾使用 assistant_id；启动时统一列名，运行时只认 id 契约。
  await migrateCallBackgroundRoleKey(db);
  // 迁移102：全部协议转为常驻提示词，保留正文并退休优先级、有效期与旧定义开关。
  await migrateProtocolPermanentInjection(db);
  // 迁移104：退休摘要与通话来源关联，替代迁移103的关联表重建；正文和处理进度独立保留。
  await retireChatSummaryCallAssociations(db);
  // 迁移105：个人资料与人设共用 user_profile，历史姓名、头像与封面保留。
  await migrateUserProfilePersona(db);
  // 迁移106：翻译服务成为辅助模型资产，旧实际使用的配置固化为业务选择。
  await migrateTranslationModels(db);
  // 迁移107：记忆增加独立摘要，旧正文与有效向量保持原样。
  await migrateMemorySummary(db);
  // 迁移108：记录首次模型，旧选择不回写；运行时仅在创建模型或角色时初始化。
  await migrateAuxiliaryModelDefaults(db);
  // 迁移109：退休工程测试页，解除其遗留的 active 测试锁，防止升级后继续阻断应用。
  await db.execAsync(RAVEN_CAT_RELEASE_MANUAL_TEST_LOCKS);
  // 迁移110：保留既有模型默认行为，只由用户明确选择关闭思考。
  const assistantColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('ai_assistants')");
  if (!assistantColumns.some((column) => column.name === 'disable_thinking')) {
    await db.execAsync('ALTER TABLE ai_assistants ADD COLUMN disable_thinking INTEGER NOT NULL DEFAULT 0');
  }
  // 迁移111：增加手动触发关系，既有自动关联与关闭开关保持原样。
  await db.execAsync(MEMORY_PASSIVE_ASSOCIATION_SCHEMA);
  // 迁移112：MCP 生效对象改为明确授权；旧服务等待用户选择，不回填全局权限。
  await db.execAsync(MCP_SERVER_ASSISTANTS_SCHEMA);
  // 迁移113：重写意图与原输入范围独立保存，不回退普通回复游标。
  await migrateChatRegeneration(db);
  // 迁移114：退休 Self Wake，计划、历史与授权收敛到唯一 AI 日程入口。
  await migrateCompanionSchedules(db);
  // 迁移115：修复旧事务连接遗漏的 MCP 授权级联；有效服务和角色的授权保持原样。
  await repairMcpAuthorizationForeignKeys(db);
}
