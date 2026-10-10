/** 声明由组装流水线直接解析、无需进入动态注册表的 Prompt Provider。 */

export const PIPELINE_PROMPT_PROVIDER_IDS = [
  'assistant.persona',
  'profile.user_identity',
  'runtime.current_time',
  'runtime.device_battery',
  'moments.recent',
  'chat.recent_history',
  'chat.summary',
  'runtime.current_input',
  'runtime.together_listening',
] as const;
