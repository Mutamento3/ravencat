/** 新增与编辑共用的账单边界表单；ID 与时间戳由仓储拥有。 */

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { ModalSheet, showAppDialog } from '@shared/ui';
import { useTheme, useThemedStyles } from '@shared/theme';
import type { WalletCategories, WalletRecord, WalletRecordType } from '../domain/WalletRecord';
import { getWalletRecordDate } from '../domain/WalletRecord';
import type { UpdateWalletRecordInput } from '../domain/LedgerRepository';
import { createAddRecordModalStyles } from './styles';

type RecordType = WalletRecordType;

const RECORD_TYPE: { EXPENSE: RecordType; INCOME: RecordType } = {
  EXPENSE: 'expense',
  INCOME: 'income',
};

interface AddRecordModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (record: Required<UpdateWalletRecordInput>) => Promise<boolean | void>;
  initialType?: RecordType;
  initialRecord?: WalletRecord | null;
  availableCategories: WalletCategories;
}

const AddRecordModal: React.FC<AddRecordModalProps> = ({
  visible,
  onClose,
  onSave,
  initialType = RECORD_TYPE.EXPENSE,
  initialRecord = null,
  availableCategories,
}) => {
  const theme = useTheme();
  const styles = useThemedStyles(createAddRecordModalStyles);
  const amountRef = useRef<TextInput>(null);

  const [type, setType] = useState<RecordType>(initialType);
  const [amount, setAmount] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [detail, setDetail] = useState<string>('');
  const [recordDate, setRecordDate] = useState(getWalletRecordDate);
  const [loading, setLoading] = useState<boolean>(false);

  // 重置
  useEffect(() => {
    if (visible) {
      setType(initialRecord ? initialRecord.type : initialType);
      setAmount(initialRecord ? String(initialRecord.amount) : '');
      setCategory(initialRecord ? initialRecord.category : '');
      setDetail(initialRecord ? initialRecord.detail : '');
      setRecordDate(initialRecord ? initialRecord.recordDate : getWalletRecordDate());
      setLoading(false);

      setTimeout(() => {
        amountRef.current?.focus();
      }, 150);
    }
  }, [visible, initialType, initialRecord]);

  // 分类缓存
  const categories = useMemo(() => {
    const options = availableCategories[type];
    return initialRecord && initialRecord.type === type && !options.includes(initialRecord.category)
      ? [...options, initialRecord.category]
      : options;
  }, [type, initialRecord, availableCategories]);

  // 金额过滤
  const handleAmountChange = useCallback((text: string) => {
    let cleaned = text.replace(/[^0-9.]/g, '');

    const parts = cleaned.split('.');

    if (parts.length > 2) return;

    if (parts[1]?.length > 2) return;

    // 修正前导0
    if (parts[0].length > 1 && parts[0].startsWith('0') && !cleaned.includes('.')) {
      cleaned = parts[0].replace(/^0+/, '0');
    }

    setAmount(cleaned);
  }, []);

  const handleSelectCategory = useCallback((cat: string) => {
    setCategory(cat);
  }, []);

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(recordDate)
    && getWalletRecordDate(new Date(`${recordDate}T12:00:00`)) === recordDate;

  const isValid = useMemo(() => {
    const parsed = Number(amount);
    return Number.isFinite(parsed) && parsed > 0 && category.trim() !== '' && validDate;
  }, [amount, category, validDate]);

  const handleSave = useCallback(async () => {
    const parsed = Number(amount);

    try {
      setLoading(true);

      const success = await onSave({
        type,
        amount: parsed,
        category: category.trim(),
        detail,
        recordDate,
      });

      if (success !== false) {
        onClose();
      }
    } catch {
      showAppDialog({ title: '错误', message: '保存失败，请重试', tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [amount, category, type, detail, recordDate, onSave, onClose]);

  return (
    <ModalSheet visible={visible} onClose={onClose}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
      >
        <View style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose}>
                <Text style={styles.cancel}>取消</Text>
              </TouchableOpacity>

              <Text style={styles.title}>{initialRecord ? '编辑账单' : '记一笔'}</Text>

              <TouchableOpacity
                onPress={handleSave}
                disabled={!isValid || loading}
              >
                <Text
                  style={[
                    styles.save,
                    (!isValid || loading) && { opacity: 0.4 },
                  ]}
                >
                  {loading ? '保存中...' : '保存'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* 类型切换 */}
            <View style={styles.typeSwitch}>
              {Object.values(RECORD_TYPE).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.typeBtn,
                    type === t && styles.typeBtnActive,
                  ]}
                  onPress={() => {
                    setType(t);
                    if (t !== type) setCategory('');
                  }}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      type === t && styles.typeBtnTextActive,
                    ]}
                  >
                    {t === RECORD_TYPE.EXPENSE ? '支出' : '收入'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* 金额 */}
            <View style={styles.amountWrap}>
              <Text style={styles.currency}>¥</Text>
              <TextInput
                ref={amountRef}
                style={styles.amountInput}
                value={amount}
                onChangeText={handleAmountChange}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor={theme.colors.text.tertiary}
                selectionColor={theme.colors.brand.primary}
                caretHidden={false}
              />
            </View>

            {/* 分类 */}
            <Text style={styles.label}>分类（选择已有或自定义）</Text>
            <View style={styles.categoryGrid}>
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.categoryBtn,
                    category === cat && styles.categoryBtnActive,
                  ]}
                  onPress={() => handleSelectCategory(cat)}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      category === cat && styles.categoryTextActive,
                    ]}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[styles.detailInput, { marginBottom: theme.spacing.lg }]}
              value={category}
              onChangeText={setCategory}
              placeholder="输入自定义分类"
              placeholderTextColor={theme.colors.text.tertiary}
            />

            <Text style={styles.label}>日期（YYYY-MM-DD）</Text>
            <TextInput
              style={[styles.detailInput, { marginBottom: theme.spacing.lg }]}
              value={recordDate}
              onChangeText={setRecordDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.colors.text.tertiary}
              maxLength={10}
              keyboardType="numbers-and-punctuation"
            />
            {!validDate && <Text style={styles.label}>请输入有效日期，如 2026-10-09</Text>}

            {/* 备注 */}
            <Text style={styles.label}>备注（选填）</Text>
            <TextInput
              style={styles.detailInput}
              value={detail}
              onChangeText={setDetail}
              placeholder="如：午餐、公交..."
              placeholderTextColor={theme.colors.text.tertiary}
              maxLength={30}
              returnKeyType="done"
              blurOnSubmit={true}
            />
        </View>
      </ScrollView>
    </ModalSheet>
  );
};

export default AddRecordModal;
