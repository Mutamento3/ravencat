/** 跨产品的动态工具装配；冷静期例外不授予当前主理身份。 */
import { getHostAICooldownStatus, ReleaseHostCooldownTool } from '@features/assistants';
import type { PrepareHostModelRun } from '@shared/aiTools';
import { prepareTogetherListeningHostModelRun } from './TogetherListeningRunPreparation';

export const prepareHostModelRun: PrepareHostModelRun = async (input) => {
  const [listening, { appointment }] = await Promise.all([
    prepareTogetherListeningHostModelRun(input),
    getHostAICooldownStatus(),
  ]);
  const canRelease = appointment.isInCooldown && appointment.revokedAIId === input.currentAiId
    && input.persistentAllowedToolNames.includes(ReleaseHostCooldownTool.name);
  return {
    ...listening,
    managedToolNames: [...listening.managedToolNames, ReleaseHostCooldownTool.name],
    dynamicAllowedToolNames: [...listening.dynamicAllowedToolNames, ...(canRelease ? [ReleaseHostCooldownTool.name] : [])],
  };
};
