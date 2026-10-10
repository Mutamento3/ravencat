/**
 * @fileoverview SearchLedgerTool - 搜索账本记录
 * 
 * @module features/wallet/aiTools/SearchLedgerTool
 */

import type { ToolContext, ToolExecuteResult } from '@shared/aiTools';
import type { ILedgerRepository } from '../domain/LedgerRepository';

/**
 * 工具定义参数类型
 */
interface SearchLedgerArgs {
  keyword: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

/**
 * 工具定义（JSON Schema）
 * 
 * 注意：此工具目前与 getLedgerContext 有重叠，
 * 后续可能需要合并或重新定义职责边界
 */
export const definition = {
  name: 'searchLedger',
  description: '按关键词搜索账本记录，返回真实账单 ID，供后续编辑或删除时定位记录',
  parameters: {
    type: 'object' as const,
    properties: {
      keyword: {
        type: 'string' as const,
        description: '搜索关键词',
      },
      startDate: {
        type: 'string' as const,
        description: '开始日期，格式YYYY-MM-DD',
      },
      endDate: {
        type: 'string' as const,
        description: '结束日期，格式YYYY-MM-DD',
      },
      limit: {
        type: 'number' as const,
        description: '返回数量限制',
        default: 10,
      },
    },
    required: ['keyword'] as const,
  },
};

/**
 * 执行工具
 * @param args - 工具参数
 * @param context - 工具执行上下文
 * @returns 工具执行结果
 */
export async function execute(
  args: SearchLedgerArgs,
  context: ToolContext
): Promise<ToolExecuteResult> {
  const ledgerRepo = context.repositories.ledger as ILedgerRepository | null;
  if (!ledgerRepo) {
    return { success: false, error: '账本仓储未注入，无法搜索账本' };
  }

  try {
    const keyword = (args?.keyword || '').trim();
    if (!keyword) {
      return { success: false, error: 'keyword 不能为空' };
    }

    const limit = Math.max(1, Math.min(50, Number(args?.limit || 10)));
    const records = await ledgerRepo.getRecords({
      keyword,
      startDate: args?.startDate,
      endDate: args?.endDate,
      limit,
    });

    const stats = await ledgerRepo.searchByKeyword(keyword, {
      startDate: args?.startDate,
      endDate: args?.endDate,
    });

    const lines = records.map((record) => {
      const typeLabel = record.type === 'expense' ? '支出' : '收入';
      const detail = record.detail ? `（${record.detail}）` : '';
      return `- ID=${record.id} ${record.recordDate} ${typeLabel} ${record.category}${detail} ¥${Number(record.amount).toFixed(2)}`;
    });

    return {
      success: true,
      message: [
        `关键词：${keyword}`,
        `命中记录数：${stats.count}`,
        `总支出：¥${Number(stats.totalExpense || 0).toFixed(2)}`,
        `总收入：¥${Number(stats.totalIncome || 0).toFixed(2)}`,
        lines.length ? '匹配记录：' : '匹配记录：暂无',
        ...lines,
      ].join('\n'),
      data: {
        records,
        stats,
      },
    };
  } catch (error) {
    console.error('[SearchLedgerTool] Failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '账本搜索工具执行失败',
    };
  }
}

/**
 * 工具对象（定义 + 执行）
 */
export const SearchLedgerTool = {
  name: definition.name,
  definition,
  execute,
};
