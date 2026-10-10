import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ChatColorOverrides, PresentationThemeId } from './types';
import { DEFAULT_THEME_ID, getThemeSelectionDisabledReason, isValidThemeId, THEME_REGISTRY } from './themeRegistry';

const STORAGE_KEY = 'presentation.theme.selectedThemeId';
const CHAT_COLOR_OVERRIDES_KEY_PREFIX = 'presentation.theme.chatColorOverrides.';

export interface StoredThemeBackupState {
  selectedThemeId: PresentationThemeId;
  chatColorOverrides: Partial<Record<PresentationThemeId, ChatColorOverrides>>;
}

export async function loadStoredThemeId(): Promise<PresentationThemeId> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && isValidThemeId(stored)) {
      // 旧设置和备份可保留未开放的主题，运行时只加载已开放主题。
      return getThemeSelectionDisabledReason(stored) ? DEFAULT_THEME_ID : stored;
    }
  } catch {
    // 主题持久化属于外部存储边界，读取失败时使用默认主题。
  }
  return DEFAULT_THEME_ID;
}

export async function saveThemeId(themeId: PresentationThemeId): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, themeId);
  } catch {
    // 写入失败不应阻断当前会话中的主题切换。
  }
}

/** 加载指定主题的聊天文字颜色覆盖层。 */
export async function loadChatColorOverrides(
  themeId: PresentationThemeId
): Promise<ChatColorOverrides> {
  try {
    const stored = await AsyncStorage.getItem(CHAT_COLOR_OVERRIDES_KEY_PREFIX + themeId);
    if (stored) {
      const parsed = JSON.parse(stored) as ChatColorOverrides;
      if (parsed && typeof parsed === 'object') {
        return {
          userText: typeof parsed.userText === 'string' ? parsed.userText : undefined,
          aiText: typeof parsed.aiText === 'string' ? parsed.aiText : undefined,
        };
      }
    }
  } catch {
    // 覆盖层读取失败时回退到主题默认值。
  }
  return {};
}

/** 保存指定主题的聊天文字颜色覆盖层。 */
export async function saveChatColorOverrides(
  themeId: PresentationThemeId,
  overrides: ChatColorOverrides
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CHAT_COLOR_OVERRIDES_KEY_PREFIX + themeId,
      JSON.stringify(overrides)
    );
  } catch {
    // 写入失败不应阻断当前会话中的颜色调整。
  }
}

/** 备份专用严格读取：只有“从未持久化”才表示默认值，读取或格式错误必须上抛。 */
export async function loadStoredThemeBackupState(): Promise<StoredThemeBackupState> {
  const themeIds = Object.keys(THEME_REGISTRY) as PresentationThemeId[];
  const keys = [
    STORAGE_KEY,
    ...themeIds.map((themeId) => CHAT_COLOR_OVERRIDES_KEY_PREFIX + themeId),
  ];
  const stored = new Map(await AsyncStorage.multiGet(keys));
  const selectedValue = stored.get(STORAGE_KEY);
  const selectedThemeId = selectedValue === null || selectedValue === undefined
    ? DEFAULT_THEME_ID
    : selectedValue;
  const chatColorOverrides = Object.fromEntries(themeIds.flatMap((themeId) => {
    const raw = stored.get(CHAT_COLOR_OVERRIDES_KEY_PREFIX + themeId);
    if (raw === null || raw === undefined) return [];
    return [[themeId, JSON.parse(raw) as unknown]];
  }));
  return parseStoredThemeBackupState({ selectedThemeId, chatColorOverrides });
}

export function parseStoredThemeBackupState(value: unknown): StoredThemeBackupState {
  if (!value || typeof value !== 'object') throw new Error('备份主题设置无效');
  const state = value as Partial<StoredThemeBackupState>;
  if (typeof state.selectedThemeId !== 'string' || !isValidThemeId(state.selectedThemeId)) {
    throw new Error('备份主题标识无效');
  }
  const overrides = state.chatColorOverrides;
  if (overrides !== undefined &&
    (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))) {
    throw new Error('备份主题颜色设置无效');
  }
  const validatedOverrides: [PresentationThemeId, ChatColorOverrides][] = [];
  for (const [themeId, colors] of Object.entries(overrides ?? {})) {
    if (!isValidThemeId(themeId) || !colors ||
      typeof colors !== 'object' || Array.isArray(colors)) {
      throw new Error('备份主题颜色设置无效');
    }
    const candidate = colors as ChatColorOverrides;
    if ((candidate.userText !== undefined && typeof candidate.userText !== 'string') ||
      (candidate.aiText !== undefined && typeof candidate.aiText !== 'string')) {
      throw new Error('备份主题颜色值无效');
    }
    validatedOverrides.push([themeId, candidate]);
  }

  return {
    selectedThemeId: state.selectedThemeId,
    chatColorOverrides: Object.fromEntries(validatedOverrides),
  };
}

export async function restoreStoredThemeBackupState(value: unknown): Promise<void> {
  const state = parseStoredThemeBackupState(value);
  const themeIds = Object.keys(THEME_REGISTRY) as PresentationThemeId[];
  await AsyncStorage.multiSet([
    [STORAGE_KEY, state.selectedThemeId],
    ...themeIds.map((themeId) => [
      CHAT_COLOR_OVERRIDES_KEY_PREFIX + themeId,
      JSON.stringify(state.chatColorOverrides[themeId] ?? {}),
    ] as [string, string]),
  ]);
}
