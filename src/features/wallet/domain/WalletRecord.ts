/**
 * @fileoverview WalletRecord 实体定义
 *
 * 羽库账本（记账）的领域实体，纯数据结构，无业务逻辑。
 * 对应数据库表：ledger_records, ledger_quick_actions
 *
 * @module features/wallet/domain/WalletRecord
 */

export type WalletRecordType = 'income' | 'expense';
export type CategoryType = 'income' | 'expense' | 'both';

export interface WalletRecord {
  id: string;
  type: WalletRecordType;
  category: string;
  detail: string;
  amount: number;
  recordDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuickAction {
  id: string;
  name: string;
  type: WalletRecordType;
  category: string;
  detail: string;
  amount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  icon?: string | null;
  sortOrder?: number;
  usageCount?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ==================== 历史记账功能新增类型 ====================

/**
 * 分类统计（用于饼图）
 */
export interface CategoryStat {
  category: string;
  type: WalletRecordType;
  amount: number;
  percentage: number;  // 占总支出/收入的百分比
  count: number;       // 笔数
  color: string;       // 饼图颜色
}

/**
 * 时间范围汇总数据
 */
export interface SummaryData {
  timeRange: {
    startDate: string;
    endDate: string;
    label: string;
  };
  totalExpense: number;
  totalIncome: number;
  balance: number;
  categoryStats: CategoryStat[];
  records: WalletRecord[];
}

interface WalletRecordRow {
  id: string;
  type: WalletRecordType;
  category: string;
  detail?: string | null;
  amount: number | string;
  record_date: string;
  created_at: string;
  updated_at: string;
}

interface QuickActionRow {
  id: string;
  name: string;
  type: WalletRecordType;
  category: string;
  detail?: string | null;
  amount: number | string;
  sort_order?: number | null;
  created_at: string;
  updated_at: string;
}

export function getWalletRecordDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createWalletRecord(data: Partial<WalletRecord> = {}): WalletRecord {
  const now = new Date().toISOString();

  return {
    id: data.id || `ledger_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: data.type || 'expense',
    category: data.category || '',
    detail: data.detail || '',
    amount: typeof data.amount === 'number' ? data.amount : 0,
    recordDate: data.recordDate || getWalletRecordDate(),
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
  };
}

export function createWalletRecordFromRow(row: WalletRecordRow): WalletRecord {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    detail: row.detail || '',
    amount: typeof row.amount === 'number' ? row.amount : parseFloat(row.amount) || 0,
    recordDate: row.record_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createQuickAction(data: Partial<QuickAction> = {}): QuickAction {
  const now = new Date().toISOString();

  return {
    id: data.id || `quick_${Date.now()}`,
    name: data.name || '',
    type: data.type || 'expense',
    category: data.category || '',
    detail: data.detail || '',
    amount: typeof data.amount === 'number' ? data.amount : 0,
    sortOrder: data.sortOrder ?? 0,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
  };
}

export function createQuickActionFromRow(row: QuickActionRow): QuickAction {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    category: row.category,
    detail: row.detail || '',
    amount: typeof row.amount === 'number' ? row.amount : parseFloat(row.amount) || 0,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createCategory(data: Partial<Category> = {}): Category {
  return {
    id: data.id || data.name || '',
    name: data.name || '',
    type: data.type || 'both',
    icon: data.icon || null,
    sortOrder: data.sortOrder ?? 0,
    usageCount: data.usageCount ?? 0,
  };
}

export function formatAmount(amount: number | string, withSymbol = true): string {
  const value = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  const formatted = value.toFixed(2);
  return withSymbol ? `¥${formatted}` : formatted;
}

export function getRecordSummary(record: WalletRecord | null | undefined): string {
  if (!record) return '';

  const typeText = record.type === 'expense' ? '支出' : '收入';
  const detailText = record.detail ? `(${record.detail})` : '';

  return `${record.category}${detailText} - ${typeText} ${formatAmount(record.amount)}`;
}

export function getRecordsSummary(records: WalletRecord[] | null | undefined): string {
  if (!records || records.length === 0) {
    return '没有记账记录';
  }

  if (records.length === 1) {
    const r = records[0];
    if (!r) return '没有记账记录';
    const typeText = r.type === 'expense' ? '支出' : '收入';
    return `用户记录了一笔记账：${r.category}${r.detail ? `(${r.detail})` : ''} - ${typeText} ${formatAmount(r.amount)}`;
  }

  const expenseRecords = records.filter(r => r.type === 'expense');
  const incomeRecords = records.filter(r => r.type === 'income');

  let summary = `用户记录了 ${records.length} 笔记账：`;

  if (expenseRecords.length > 0) {
    const totalExpense = expenseRecords.reduce((sum, r) => sum + r.amount, 0);
    summary += `\n支出 ${expenseRecords.length} 笔，共 ${formatAmount(totalExpense)}：`;
    expenseRecords.forEach(r => {
      summary += `\n- ${r.category}${r.detail ? `(${r.detail})` : ''} ${formatAmount(r.amount)}`;
    });
  }

  if (incomeRecords.length > 0) {
    const totalIncome = incomeRecords.reduce((sum, r) => sum + r.amount, 0);
    summary += `\n收入 ${incomeRecords.length} 笔，共 ${formatAmount(totalIncome)}：`;
    incomeRecords.forEach(r => {
      summary += `\n- ${r.category}${r.detail ? `(${r.detail})` : ''} ${formatAmount(r.amount)}`;
    });
  }

  return summary;
}

export function validateWalletRecord(record: WalletRecord): ValidationResult {
  const errors: string[] = [];

  if (!record.type || !['income', 'expense'].includes(record.type)) {
    errors.push('type 必须是 income 或 expense');
  }
  if (!record.category || typeof record.category !== 'string') {
    errors.push('category 不能为空');
  }
  if (typeof record.amount !== 'number' || Number.isNaN(record.amount) || record.amount < 0) {
    errors.push('amount 必须是有效的非负数');
  }
  if (!record.recordDate || !/^\d{4}-\d{2}-\d{2}$/.test(record.recordDate)) {
    errors.push('recordDate 格式必须是 YYYY-MM-DD');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateQuickAction(action: QuickAction): ValidationResult {
  const errors: string[] = [];

  if (!action.name || typeof action.name !== 'string') {
    errors.push('name 不能为空');
  }
  if (!action.type || !['income', 'expense'].includes(action.type)) {
    errors.push('type 必须是 income 或 expense');
  }
  if (!action.category || typeof action.category !== 'string') {
    errors.push('category 不能为空');
  }
  if (typeof action.amount !== 'number' || Number.isNaN(action.amount) || action.amount < 0) {
    errors.push('amount 必须是有效的非负数');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

