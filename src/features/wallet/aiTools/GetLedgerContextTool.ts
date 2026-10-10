/**
 * @fileoverview GetLedgerContextTool - 获取账本记录和统计信息
 * 
 * @module features/wallet/aiTools/GetLedgerContextTool
 */

import type { ToolContext, ToolExecuteResult } from '@shared/aiTools';
import type { WalletRecord, WalletRecordType } from '../domain/WalletRecord';
import { getWalletRecordDate } from '../domain/WalletRecord';
import type {
  ILedgerRepository,
  LedgerKeywordSearchStats,
  MonthlyLedgerStats,
  YearlyLedgerStats,
} from '../domain/LedgerRepository';

/**
 * 工具定义参数类型
 */
interface GetLedgerContextArgs {
  mode: 'recent' | 'stats' | 'keyword';
  timeDescription?: string;
  keyword?: string;
  type?: WalletRecordType;
  category?: string;
}

/**
 * 时间解析结果
 */
interface TimeResolution {
  year?: number;
  month?: number;
  startDate?: string;
  endDate?: string;
}

/**
 * 账本记录汇总
 */
interface LedgerSummary {
  count: number;
  totalExpense: number;
  totalIncome: number;
  balance: number;
  topCategories: {
    category: string;
    count: number;
    amount: number;
  }[];
}

/**
 * 构建过滤器的选项
 */
interface FilterOptions {
  limit?: number;
}

/**
 * 工具定义（JSON Schema）
 */
export const definition = {
  name: 'getLedgerContext',
  description: '获取账本记录与统计信息；recent 或 keyword 模式会返回真实账单 ID。',
  parameters: {
    type: 'object' as const,
    properties: {
      mode: {
        type: 'string' as const,
        enum: ['recent', 'stats', 'keyword'] as const,
        description: '查询模式：recent最近记录、stats统计、keyword关键词搜索',
      },
      timeDescription: {
        type: 'string' as const,
        description: '时间描述，如"本月"、"最近7天"、"2024年1月"',
      },
      keyword: {
        type: 'string' as const,
        description: '搜索关键词（mode为keyword时使用）',
      },
      type: {
        type: 'string' as const,
        enum: ['income', 'expense'] as const,
        description: '筛选类型：收入或支出',
      },
      category: {
        type: 'string' as const,
        description: '分类筛选',
      },
    },
    required: ['mode'] as const,
  },
};

/**
 * 执行工具
 * @param args - 工具参数
 * @param context - 工具执行上下文
 * @returns 工具执行结果
 */
export async function execute(
  args: GetLedgerContextArgs,
  context: ToolContext
): Promise<ToolExecuteResult> {
  const ledgerRepo = context.repositories.ledger as ILedgerRepository | null;
  if (!ledgerRepo) {
    return { success: false, error: '账本仓储未注入，无法查询账本' };
  }

  try {
    const mode = args?.mode;
    const resolved = resolveTimeDescription(args.timeDescription);

    if (mode === 'keyword') {
      if (!args?.keyword) {
        return { success: false, error: 'keyword 模式需要 keyword 参数' };
      }

      const matchedRecords = await ledgerRepo.getRecords({
        keyword: args.keyword,
        type: args.type,
        category: args.category,
        startDate: resolved.startDate,
        endDate: resolved.endDate,
        year: resolved.year,
        month: resolved.month,
        limit: 20,
      });

      const stats = await ledgerRepo.searchByKeyword(args.keyword, {
        year: resolved.year,
        month: resolved.month,
        startDate: resolved.startDate,
        endDate: resolved.endDate,
      });

      return {
        success: true,
        message: buildKeywordMessage(args.keyword, matchedRecords, stats, args.timeDescription),
        data: {
          records: matchedRecords,
          stats,
        },
      };
    }

    if (mode === 'recent') {
      const filters = buildLedgerFilters(args, { limit: 20 });
      const records = await ledgerRepo.getRecords(filters);

      return {
        success: true,
        message: buildRecentMessage(records, args.timeDescription),
        data: {
          filters,
          records,
          summary: summarizeRecords(records),
        },
      };
    }

    if (mode === 'stats') {
      if (!args.type && !args.category && resolved.year && resolved.month) {
        const stats = await ledgerRepo.getMonthlyStats(resolved.year, resolved.month);
        return {
          success: true,
          message: buildMonthlyStatsMessage(stats, args.timeDescription),
          data: stats,
        };
      }

      if (!args.type && !args.category && resolved.year && !resolved.month && !resolved.startDate) {
        const stats = await ledgerRepo.getYearlyStats(resolved.year);
        return {
          success: true,
          message: buildYearlyStatsMessage(stats, args.timeDescription),
          data: stats,
        };
      }

      const filters = buildLedgerFilters(args, { limit: 500 });
      const records = await ledgerRepo.getRecords(filters);
      const summary = summarizeRecords(records);

      return {
        success: true,
        message: buildStatsMessage(summary, args.timeDescription),
        data: {
          filters,
          summary,
          sampleRecords: records.slice(0, 10),
        },
      };
    }

    return { success: false, error: `未知模式: ${mode}` };
  } catch (error) {
    console.error('[GetLedgerContextTool] Failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '账本工具执行失败',
    };
  }
}

/**
 * 工具对象（定义 + 执行）
 */
export const GetLedgerContextTool = {
  name: definition.name,
  definition,
  execute,
};

function buildLedgerFilters(
  args: Partial<GetLedgerContextArgs> = {},
  options: FilterOptions = {}
): Record<string, unknown> {
  const resolved = resolveTimeDescription(args.timeDescription);
  return {
    limit: options.limit || 20,
    type: args.type,
    category: args.category,
    year: resolved.year,
    month: resolved.month,
    startDate: resolved.startDate,
    endDate: resolved.endDate,
  };
}

function resolveTimeDescription(timeDescription: string | undefined): TimeResolution {
  const text = (timeDescription || '').trim();
  if (!text) {
    return {};
  }

  const now = new Date();
  const today = getWalletRecordDate(now);

  if (text === '今天' || text === '今日') {
    return { startDate: today, endDate: today };
  }

  if (text === '昨天') {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const date = getWalletRecordDate(yesterday);
    return { startDate: date, endDate: date };
  }

  if (text === '本月' || text === '这个月') {
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  if (text === '上月') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { year: lastMonth.getFullYear(), month: lastMonth.getMonth() + 1 };
  }

  if (text === '今年') {
    return { year: now.getFullYear() };
  }

  if (text === '去年') {
    return { year: now.getFullYear() - 1 };
  }

  const recentDaysMatch = /^最近\s*(\d+)\s*天$/.exec(text);
  if (recentDaysMatch) {
    const days = Math.max(1, Number(recentDaysMatch[1]));
    const start = new Date(now);
    start.setDate(start.getDate() - (days - 1));
    return { startDate: getWalletRecordDate(start), endDate: today };
  }

  const exactDateMatch = /^(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})日?$/.exec(text);
  if (exactDateMatch) {
    const [, year, month, day] = exactDateMatch;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { startDate: date, endDate: date };
  }

  const monthMatch = /^(\d{4})[-\/年](\d{1,2})月?$/.exec(text);
  if (monthMatch) {
    return {
      year: Number(monthMatch[1]),
      month: Number(monthMatch[2]),
    };
  }

  const yearMatch = /^(\d{4})年?$/.exec(text);
  if (yearMatch) {
    return { year: Number(yearMatch[1]) };
  }

  return {};
}

function buildRecentMessage(records: WalletRecord[], timeDescription: string | undefined): string {
  const label = timeDescription ? `时间范围：${timeDescription}` : '时间范围：最近记录';
  if (!records.length) {
    return `${label}\n没有找到相关账本记录。`;
  }

  const lines = records.map((record) => {
    const typeLabel = record.type === 'expense' ? '支出' : '收入';
    const detail = record.detail ? `（${record.detail}）` : '';
    return `- ID=${record.id} ${record.recordDate} ${typeLabel} ${record.category}${detail} ¥${Number(record.amount).toFixed(2)}`;
  });

  return [label, `共找到 ${records.length} 条记录：`, ...lines].join('\n');
}

function buildStatsMessage(summary: LedgerSummary, timeDescription: string | undefined): string {
  const label = timeDescription ? `统计范围：${timeDescription}` : '统计范围：当前筛选结果';
  return [
    label,
    `总笔数：${summary.count}`,
    `总支出：¥${summary.totalExpense.toFixed(2)}`,
    `总收入：¥${summary.totalIncome.toFixed(2)}`,
    `结余：¥${summary.balance.toFixed(2)}`,
    summary.topCategories.length
      ? `高频分类：${summary.topCategories.map((item) => `${item.category}(${item.count}笔)`).join('、')}`
      : '高频分类：暂无',
  ].join('\n');
}

function buildMonthlyStatsMessage(
  stats: MonthlyLedgerStats,
  timeDescription: string | undefined
): string {
  const label = timeDescription
    ? `统计范围：${timeDescription}`
    : `统计范围：${stats.year}年${stats.month}月`;
  const topCategories = (stats.categories || []).slice(0, 5);
  return [
    label,
    `总笔数：${stats.count}`,
    `总支出：¥${Number(stats.totalExpense || 0).toFixed(2)}`,
    `总收入：¥${Number(stats.totalIncome || 0).toFixed(2)}`,
    `结余：¥${Number(stats.balance || 0).toFixed(2)}`,
    topCategories.length
      ? `高频分类：${topCategories.map((item) => `${item.category}(${item.count}笔)`).join('、')}`
      : '高频分类：暂无',
  ].join('\n');
}

function buildYearlyStatsMessage(
  stats: YearlyLedgerStats,
  timeDescription: string | undefined
): string {
  const label = timeDescription ? `统计范围：${timeDescription}` : `统计范围：${stats.year}年`;
  const topCategories = (stats.categories || []).slice(0, 5);
  return [
    label,
    `总笔数：${stats.count}`,
    `总支出：¥${Number(stats.totalExpense || 0).toFixed(2)}`,
    `总收入：¥${Number(stats.totalIncome || 0).toFixed(2)}`,
    `结余：¥${Number(stats.balance || 0).toFixed(2)}`,
    topCategories.length
      ? `高频分类：${topCategories.map((item) => `${item.category}(${item.count}笔)`).join('、')}`
      : '高频分类：暂无',
  ].join('\n');
}

function buildKeywordMessage(
  keyword: string,
  records: WalletRecord[],
  stats: LedgerKeywordSearchStats,
  timeDescription: string | undefined
): string {
  const label = timeDescription ? `范围：${timeDescription}` : '范围：全部记录';
  const recordLines = records.map((record) => {
    const typeLabel = record.type === 'expense' ? '支出' : '收入';
    const detail = record.detail ? `（${record.detail}）` : '';
    return `- ID=${record.id} ${record.recordDate} ${typeLabel} ${record.category}${detail} ¥${Number(record.amount).toFixed(2)}`;
  });

  return [
    `关键词：${keyword}`,
    label,
    `命中记录数：${stats.count}`,
    `相关支出：¥${Number(stats.totalExpense || 0).toFixed(2)}`,
    `相关收入：¥${Number(stats.totalIncome || 0).toFixed(2)}`,
    recordLines.length ? '命中示例：' : '命中示例：暂无',
    ...recordLines,
  ].join('\n');
}

function summarizeRecords(records: WalletRecord[]): LedgerSummary {
  const summary: LedgerSummary = {
    count: records.length,
    totalExpense: 0,
    totalIncome: 0,
    balance: 0,
    topCategories: [],
  };

  const categoryMap = new Map<string, { category: string; count: number; amount: number }>();

  records.forEach((record) => {
    const amount = Number(record.amount) || 0;
    if (record.type === 'expense') {
      summary.totalExpense += amount;
    } else {
      summary.totalIncome += amount;
    }

    const current = categoryMap.get(record.category) || { category: record.category, count: 0, amount: 0 };
    current.count += 1;
    current.amount += amount;
    categoryMap.set(record.category, current);
  });

  summary.balance = summary.totalIncome - summary.totalExpense;
  summary.topCategories = Array.from(categoryMap.values())
    .sort((a, b) => b.count - a.count || b.amount - a.amount)
    .slice(0, 5);

  return summary;
}
