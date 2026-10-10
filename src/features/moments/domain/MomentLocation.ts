/**
 * Moment 显示地点的 Domain 规则。
 *
 * 这里只有一个「用户手填的显示地点」：不是 GPS 事实、不含坐标、不含 provider place id、
 * 不申请系统定位权限。需要真实地图能力时再扩展 structured place metadata，不要提前把
 * 第一版设计成地图 Domain。
 *
 * 归一化规则只有这一份实现：调用点不得各自复制「trim / 空值 / 长度」的判断，仓储也不再
 * 猜默认值——它只接受已经 canonical 的 `string | null`。
 */

import { MomentDomainError } from './MomentErrors';

/** 显示地点长度上限。超出直接拒绝，不静默截断用户填写的内容。 */
export const MAX_MOMENT_LOCATION_LABEL_LENGTH = 120;

/**
 * 把调用方给的地点输入归一化为 canonical 值：
 *
 * - `undefined` / `null` / trim 后为空 → `null`（「没有地点」只有这一种表示）；
 * - 1..120 字符 → trim 后的文本；
 * - 超过 120 字符 → `MomentDomainError('invalid_location_label')`。
 */
export function normalizeMomentLocationLabel(
  input: string | null | undefined
): string | null {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return null;
  if (value.length > MAX_MOMENT_LOCATION_LABEL_LENGTH) {
    throw new MomentDomainError(
      'invalid_location_label',
      `地点不能超过 ${MAX_MOMENT_LOCATION_LABEL_LENGTH} 个字符`
    );
  }
  return value;
}
