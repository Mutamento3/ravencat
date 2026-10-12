/** Phone Tools 的产品目录；不承载 Runtime 注册或执行元数据。 */

export const PHONE_TOOL_CATEGORIES = [
  { id: 'awareness', title: '环境感知' },
  { id: 'observation', title: '屏幕读取' },
  { id: 'action', title: '应用操作' },
] as const;

export type PhoneToolCategory = (typeof PHONE_TOOL_CATEGORIES)[number]['id'];

export type PhoneToolImplementationStatus = 'available' | 'planned';

export type PhoneToolCatalogItemId =
  | 'installedAppSearch'
  | 'foregroundApp'
  | 'appUsage'
  | 'currentLocation'
  | 'accessibilityScreenRead'
  | 'ocrScreenRead'
  | 'appLaunch'
  | 'softAppLock'
  | 'softAppLockRelease';

export interface PhoneToolCatalogItem {
  id: PhoneToolCatalogItemId;
  toolName: string;
  category: PhoneToolCategory;
  title: string;
  description: string;
  implementationStatus: PhoneToolImplementationStatus;
}

export const PHONE_TOOL_CATALOG = [
  {
    id: 'installedAppSearch',
    toolName: 'search_installed_apps',
    category: 'awareness',
    title: '搜索已安装应用',
    description: '搜索本机已安装且可启动的应用，获取真实应用名称和 Android package，供其他手机工具精确定位目标。',
    implementationStatus: 'available',
  },
  {
    id: 'foregroundApp',
    toolName: 'get_foreground_app',
    category: 'awareness',
    title: '获取当前应用',
    description: '获取当前可靠识别到的前台应用及其受保护状态。',
    implementationStatus: 'available',
  },
  {
    id: 'appUsage',
    toolName: 'get_app_usage',
    category: 'awareness',
    title: '读取应用使用时长',
    description: '按需查询今天、昨天或最近 7 天的应用前台使用时长，需要系统使用情况访问权限。',
    implementationStatus: 'available',
  },
  {
    id: 'currentLocation',
    toolName: 'get_current_location',
    category: 'awareness',
    title: '获取当前位置',
    description: '按需获取一次手机经纬度、精度与测量时间，支持大致位置；需要定位权限并开启系统定位。',
    implementationStatus: 'available',
  },
  {
    id: 'accessibilityScreenRead',
    toolName: 'read_screen_accessibility',
    category: 'observation',
    title: '读取页面文字',
    description: '读取当前页面通过 Android Accessibility 暴露的文字和必要界面结构。',
    implementationStatus: 'available',
  },
  {
    id: 'ocrScreenRead',
    toolName: 'read_screen_ocr',
    category: 'observation',
    title: 'OCR 读取屏幕',
    description: '对当前屏幕画面做一次安全截图快照，并通过本地 OCR 读取可见文字。',
    implementationStatus: 'available',
  },
  {
    id: 'appLaunch',
    toolName: 'open_app',
    category: 'action',
    title: '打开应用',
    description: '使用精确 Android package name 向系统派发普通应用启动请求。',
    implementationStatus: 'available',
  },
  {
    id: 'softAppLock',
    toolName: 'soft_lock_app',
    category: 'action',
    title: '锁定应用',
    description: '临时限制指定应用继续使用，可配置锁定时显示的阻断页面。',
    implementationStatus: 'available',
  },
  {
    id: 'softAppLockRelease',
    toolName: 'release_soft_lock',
    category: 'action',
    title: '解除应用锁定',
    description: '解除主理 AI 自己创建的有效应用锁定。',
    implementationStatus: 'available',
  },
] as const satisfies readonly PhoneToolCatalogItem[];
