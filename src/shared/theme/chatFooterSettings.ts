/** 纸条主题聊天底栏的自定义设置：一句话文字 + 一个图标文件引用。 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHAT_FOOTER_SETTINGS_KEY = 'presentation.theme.paperNoteChatFooter';

/** 底栏图标当前只允许这三种静态格式；动态格式以后开放时再扩展这里的校验。 */
export const CHAT_FOOTER_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;

export interface ChatFooterImageRef {
  /** persistent-image backing 内的 backing-relative locator（chat-footer/ 前缀）。 */
  storageKey: string;
  mimeType: string;
}

export interface ChatFooterSettings {
  /** 自定义文字；null 表示使用默认文案。 */
  text: string | null;
  /** 自定义图标；null 表示使用内置 yaya.png。 */
  image: ChatFooterImageRef | null;
}

export const DEFAULT_CHAT_FOOTER_SETTINGS: ChatFooterSettings = { text: null, image: null };

function isValidStorageKey(storageKey: unknown): storageKey is string {
  if (typeof storageKey !== 'string' || !storageKey) return false;
  const segments = storageKey.split('/');
  return !storageKey.startsWith('/')
    && !storageKey.includes('\\')
    && !storageKey.includes('%')
    && segments.every((segment) => segment && segment !== '.' && segment !== '..');
}

function isSupportedImageMimeType(mimeType: unknown): mimeType is string {
  return typeof mimeType === 'string'
    && (CHAT_FOOTER_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** 严格解析：备份导入与备份自检共用，任何字段不合法都上抛。 */
export function parseChatFooterSettings(value: unknown): ChatFooterSettings {
  if (value === null || value === undefined) return DEFAULT_CHAT_FOOTER_SETTINGS;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('备份聊天底栏设置无效');
  }
  const candidate = value as Partial<ChatFooterSettings>;
  if (candidate.text !== null && candidate.text !== undefined && typeof candidate.text !== 'string') {
    throw new Error('备份聊天底栏文字无效');
  }
  if (candidate.image !== null && candidate.image !== undefined) {
    const image = candidate.image;
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      throw new Error('备份聊天底栏图标无效');
    }
    const imageRef = image as Partial<ChatFooterImageRef>;
    if (!isValidStorageKey(imageRef.storageKey) || !isSupportedImageMimeType(imageRef.mimeType)) {
      throw new Error('备份聊天底栏图标无效');
    }
    return {
      text: typeof candidate.text === 'string' && candidate.text.trim() ? candidate.text : null,
      image: { storageKey: imageRef.storageKey, mimeType: imageRef.mimeType },
    };
  }
  return {
    text: typeof candidate.text === 'string' && candidate.text.trim() ? candidate.text : null,
    image: null,
  };
}

/** 运行时宽松读取：存储损坏或格式错误时回退默认，不阻断聊天界面。 */
export async function loadChatFooterSettings(): Promise<ChatFooterSettings> {
  try {
    const stored = await AsyncStorage.getItem(CHAT_FOOTER_SETTINGS_KEY);
    if (stored === null) return DEFAULT_CHAT_FOOTER_SETTINGS;
    return parseChatFooterSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_CHAT_FOOTER_SETTINGS;
  }
}

export async function saveChatFooterSettings(settings: ChatFooterSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAT_FOOTER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 与其他外观偏好一致，写入失败不阻断当前会话中的调整。
  }
}

/** 备份严格读取：只有“从未持久化”才表示默认值，读取或格式错误必须上抛。 */
export async function loadStoredChatFooterBackupState(): Promise<ChatFooterSettings | undefined> {
  const stored = await AsyncStorage.getItem(CHAT_FOOTER_SETTINGS_KEY);
  if (stored === null) return undefined;
  return parseChatFooterSettings(JSON.parse(stored));
}

export async function restoreStoredChatFooterBackupState(settings: ChatFooterSettings | undefined): Promise<void> {
  // 备份里没有底栏设置时恢复为默认（null），与主题覆盖层的恢复语义一致。
  await AsyncStorage.setItem(CHAT_FOOTER_SETTINGS_KEY, JSON.stringify(settings ?? null));
}
