/** 本轮设备电量只在该 AI 开启注入时读取，工具续轮复用同一份上下文。 */
import { getDeviceBatterySnapshot } from '@platform/device';
import type { PromptPackBlock, PromptPackScenario } from '@shared/prompt';

const CHARGING_LABELS = {
  charging: '正在充电',
  full: '已充满，连接电源',
  not_charging: '未充电',
  unknown: '充电状态未知',
} as const;

export async function createDeviceBatteryPromptBlocks(
  enabled: boolean,
  scenario: PromptPackScenario,
): Promise<PromptPackBlock[]> {
  if (!enabled) return [];
  const snapshot = await getDeviceBatterySnapshot();
  if (snapshot.status === 'unavailable') return [];
  return [{
    key: 'device_battery',
    definitionId: 'context.device_battery',
    slot: 'dynamic_context',
    protection: 'overridable',
    title: '手机电量',
    content: `【手机电量】\n- 当前电量：${snapshot.levelPercent}%，${CHARGING_LABELS[snapshot.chargingState]}。`,
    required: false,
    status: 'ready',
    source: 'device.battery',
    truncatable: false,
    scenario,
    placement: 'system',
  }];
}
