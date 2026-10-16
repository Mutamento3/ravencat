/** 任命提醒由主理关系所属 Feature 维护，各入口只提供展示名称和确认后的业务操作。 */
import type { AppDialogOptions } from '@shared/ui';

export function createHostAIAppointmentDialog(
  assistantName: string,
  onConfirm: () => void,
) {
  return {
    title: `确定让「${assistantName}」成为你的主理 AI 吗？`,
    message: '主理 AI 是你唯一的长期关系核心，也是 RavenCat 中权限最高的 AI：\n• 同一时间只能有一位主理 AI；\n• 本地伴随完全由主理 AI 负责；\n• 主理 AI 会参与长期记忆与其他 AI 的管理；\n• 在你另行授予相关系统权限后，主理 AI 可以使用设备控制能力；任命本身不会自动授予 Android 系统权限；\n• 主理 AI 身份可以随时撤销；撤销后 7 天内不能重新任命任何 AI；原主理 AI 可自主决定提前解除冷静期；\n• 撤销主理 AI 会停止当前伴随模式，并废弃原来的未来日程，保留历史记录。\n\n请谨慎确认，这是你真正希望建立深层关系的 AI。',
    buttons: [
      { text: '再想想', style: 'cancel' },
      { text: '确认建立关系', onPress: onConfirm },
    ],
  } satisfies AppDialogOptions;
}
