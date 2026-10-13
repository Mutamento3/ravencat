export const CAPABILITY_META = {
  general: {
    label: '通用辅助模型',
    description: '管理可复用的连接与模型参数，创建角色或管理员时可复制填入，各自独立修改',
    icon: 'options-outline',
    iconColor: '#5C6BC0',
  },
  embedding: {
    label: '向量化模型',
    description: '用于记忆与表情包等系统的向量化，各系统分别选择实际使用的配置',
    icon: 'git-merge-outline',
    iconColor: '#34C759',
  },
  ocr: {
    label: '视觉识别（OCR）',
    description: '用于图片文字与画面理解，聊天、表情包与时刻分别选择实际使用的配置',
    icon: 'eye-outline',
    iconColor: '#FF9500',
  },
  stt: {
    label: 'STT 模型',
    description: '管理语音识别配置，并在此选择所有角色的聊天录音与通话使用的模型',
    icon: 'mic-outline',
    iconColor: '#5856D6',
  },
  tts: {
    label: 'TTS 模型',
    description: '用于角色语音合成，每个角色在自己的模型设置中选择实际使用的配置',
    icon: 'volume-high-outline',
    iconColor: '#AF52DE',
  },
  translation: {
    label: '翻译模型',
    description: '管理 AI 模型与腾讯云翻译配置，并在此选择单聊和群聊使用的翻译模型',
    icon: 'language-outline',
    iconColor: '#007AFF',
  },
} as const;
