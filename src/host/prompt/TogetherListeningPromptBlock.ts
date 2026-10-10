/** 将一次模型 run 的 Together Listening snapshot 投影成不可截断的当前事实。 */

import {
  buildUserRuntimeStatusItems,
  type TogetherListeningRuntimeSnapshot,
} from '@features/togetherListening';
import type {
  PromptPackBlock,
  PromptPackScenario,
} from '@shared/prompt';

export function createTogetherListeningRuntimePromptBlock(input: {
  snapshot: TogetherListeningRuntimeSnapshot;
  currentAiId: string;
  scenario: PromptPackScenario;
}): PromptPackBlock {
  const sections: string[] = [];
  const statusItems = buildUserRuntimeStatusItems(input.snapshot);
  if (statusItems.length > 0) {
    sections.push([
      '【当前用户状态】',
      ...statusItems.map((item) => `- ${item.text}`),
    ].join('\n'));
  }

  const activity = input.snapshot.activity;
  if (
    activity?.phase === 'active'
    && activity.hostAiId === input.currentAiId
    && input.snapshot.netease.available
  ) {
    const artist = input.snapshot.netease.artist
      ? ` — ${input.snapshot.netease.artist}`
      : '';
    sections.push([
      '【当前共同活动】',
      '- 你与用户正在一起听。',
      `- 当前正在一起听：网易云音乐《${input.snapshot.netease.title}》${artist}`,
    ].join('\n'));
  }

  return {
    key: 'together_listening_runtime',
    instanceId: 'host:context.together_listening_runtime',
    definitionId: 'context.together_listening_runtime',
    slot: 'dynamic_context',
    protection: 'locked',
    title: '用户运行时状态与当前共同活动',
    content: sections.join('\n\n'),
    required: true,
    status: 'ready',
    source: 'TogetherListeningRuntimeSnapshot',
    truncatable: false,
    scenario: input.scenario,
    placement: 'system',
  };
}
