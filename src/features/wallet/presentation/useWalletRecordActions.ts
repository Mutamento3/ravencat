/** 首页与历史详情共用账单操作，保存后由当前页面刷新自己的列表与统计。 */
import { useState } from 'react';
import { showAppDialog } from '@shared/ui';
import { deleteWalletRecord, updateWalletRecord } from '../composition';
import type { UpdateWalletRecordInput } from '../domain/LedgerRepository';
import type { WalletRecord } from '../domain/WalletRecord';

export function useWalletRecordActions(reload: () => Promise<void>) {
  const [editingRecord, setEditingRecord] = useState<WalletRecord | null>(null);
  const [mutatingRecordId, setMutatingRecordId] = useState<string | null>(null);

  const saveRecord = async (updates: UpdateWalletRecordInput): Promise<boolean> => {
    const record = editingRecord!;
    setMutatingRecordId(record.id);
    try {
      const changed = await updateWalletRecord(record.id, updates);
      await reload();
      if (!changed) {
        showAppDialog({ title: '账单不存在', message: '这条记录已被删除，请关闭编辑后重新选择。' });
      }
      return changed;
    } catch (error) {
      console.error('[Wallet] Failed to edit record:', error);
      showAppDialog({ title: '错误', message: '编辑记录失败', tone: 'error' });
      return false;
    } finally {
      setMutatingRecordId(null);
    }
  };

  const showRecordActions = (record: WalletRecord): void => {
    showAppDialog({ title: '账单操作', message: `${record.category} · ¥${record.amount.toFixed(2)}`, buttons: [
      { text: '取消', style: 'cancel' },
      { text: '编辑', onPress: () => setEditingRecord(record) },
      {
        text: '删除', style: 'destructive',
        onPress: () => showAppDialog({ title: '删除记录', message: '确定删除这条账单？', buttons: [
          { text: '取消', style: 'cancel' },
          {
            text: '删除', style: 'destructive',
            onPress: async () => {
              setMutatingRecordId(record.id);
              try {
                const changed = await deleteWalletRecord(record.id);
                await reload();
                if (!changed) showAppDialog({ title: '账单不存在', message: '这条记录已被删除。' });
              } catch (error) {
                console.error('[Wallet] Failed to delete record:', error);
                showAppDialog({ title: '错误', message: '删除记录失败', tone: 'error' });
              } finally {
                setMutatingRecordId(null);
              }
            },
          },
        ] }),
      },
    ] });
  };

  return {
    editingRecord, mutatingRecordId, saveRecord, showRecordActions,
    closeEditor: () => setEditingRecord(null),
  };
}
