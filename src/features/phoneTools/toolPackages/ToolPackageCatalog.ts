/** Phone Tool Package 产品目录；只承载发现、分组与展示信息。 */

export type PhoneToolPackageStatus = 'available' | 'planned';

export interface PhoneToolPackageTool {
  id: string;
  toolName: string;
  title: string;
  description: string;
  implementationStatus: PhoneToolPackageStatus;
}

export interface PhoneToolPackage {
  id: string;
  icon: 'notebook' | 'music';
  title: string;
  description: string;
  implementationStatus: PhoneToolPackageStatus;
  tools: readonly PhoneToolPackageTool[];
}

export const PHONE_TOOL_PACKAGE_CATALOG = [
  {
    id: 'xiaohongshu',
    icon: 'notebook',
    title: '小红书文字笔记',
    description: '测试功能，尚不稳定。可逐步编写文字笔记、添加话题并发布，仅适配部分机型与版本。',
    implementationStatus: 'available',
    tools: [
      { id: 'getPage', toolName: 'xiaohongshu_get_page', title: '确认当前页面',
        description: '只读查看所在页面、键盘状态和可执行步骤，失败后也可调用。', implementationStatus: 'available' },
      { id: 'enterPublishing', toolName: 'xiaohongshu_enter_publishing', title: '进入发布入口',
        description: '打开创作菜单，停在从相册选择或写文字的入口。', implementationStatus: 'available' },
      { id: 'openTextEntry', toolName: 'xiaohongshu_open_text_entry', title: '打开写文字',
        description: '进入写想法或写长文的分叉页。', implementationStatus: 'available' },
      { id: 'startTextNote', toolName: 'xiaohongshu_start_text_note', title: '选择写想法',
        description: '进入文字卡片输入框，沿用写想法的笔记路线。', implementationStatus: 'available' },
      { id: 'setCardText', toolName: 'xiaohongshu_set_card_text', title: '填写卡片文字',
        description: '设置卡片文字，保留换行，不自动进入下一步。', implementationStatus: 'available' },
      { id: 'next', toolName: 'xiaohongshu_next', title: '进入下一步',
        description: '在卡片输入或预览页只点击一次下一步，返回实际到达的页面。', implementationStatus: 'available' },
      { id: 'selectStyle', toolName: 'xiaohongshu_select_style', title: '选择卡片样式',
        description: '选择当前可见的样式槽位，确认选择结果。', implementationStatus: 'available' },
      { id: 'setTitle', toolName: 'xiaohongshu_set_title', title: '填写笔记标题',
        description: '单独设置标题并确认结果。', implementationStatus: 'available' },
      { id: 'setBody', toolName: 'xiaohongshu_set_body', title: '填写笔记正文',
        description: '整体替换正文；应先写正文再添加话题。', implementationStatus: 'available' },
      { id: 'addTopic', toolName: 'xiaohongshu_add_topic', title: '添加一个话题',
        description: '每次只添加一个话题，会覆盖系统剪贴板，完成后返回当前页面。', implementationStatus: 'available' },
      { id: 'setVisibility', toolName: 'xiaohongshu_set_visibility', title: '设置可见范围',
        description: '设置公开可见或仅自己可见，不执行发布。', implementationStatus: 'available' },
      { id: 'goBack', toolName: 'xiaohongshu_go_back', title: '返回上一步',
        description: '只返回一次或收起键盘，不自动丢弃编辑内容。', implementationStatus: 'available' },
      { id: 'preparePublish', toolName: 'xiaohongshu_prepare_publish', title: '检查待发布笔记',
        description: '核对当前内容并取得一次性发布凭据，可停在这里让用户检查。', implementationStatus: 'available' },
      { id: 'publishPreparedNote', toolName: 'xiaohongshu_publish_prepared_note', title: '发布已准备笔记',
        description: '核对准备凭据和页面内容后，只点击一次发布。', implementationStatus: 'available' },
    ],
  },
  {
    id: 'neteaseMusic',
    icon: 'music',
    title: '网易云音乐工具包',
    description: '用于音乐搜索、精确播放、当前播放状态、播放控制与公开歌单读取。',
    implementationStatus: 'available',
    tools: [
      {
        id: 'searchSongs',
        toolName: 'netease_search_songs',
        title: '搜索歌曲',
        description: '搜索歌曲候选及其稳定数字 ID。',
        implementationStatus: 'available',
      },
      {
        id: 'searchPublicPlaylists',
        toolName: 'netease_search_public_playlists',
        title: '搜索公开歌单',
        description: '搜索公开歌单候选。',
        implementationStatus: 'available',
      },
      {
        id: 'getPublicPlaylist',
        toolName: 'netease_get_public_playlist',
        title: '读取公开歌单',
        description: '分页读取公开歌单的元数据和歌曲。',
        implementationStatus: 'available',
      },
      {
        id: 'getSongLyrics',
        toolName: 'netease_get_song_lyrics',
        title: '读取歌词',
        description: '读取指定歌曲的歌词及可用状态。',
        implementationStatus: 'available',
      },
      {
        id: 'resolveShareLink',
        toolName: 'netease_resolve_share_link',
        title: '解析分享链接',
        description: '将分享链接解析为歌曲或歌单的稳定数字 ID。',
        implementationStatus: 'available',
      },
      {
        id: 'playSong',
        toolName: 'netease_play_song',
        title: '播放歌曲',
        description: '按精确歌曲 ID 向官方客户端派发播放请求。',
        implementationStatus: 'available',
      },
      {
        id: 'getPlaybackState',
        toolName: 'netease_get_playback_state',
        title: '读取当前播放',
        description: '读取当前活动播放会话的歌曲、状态与控制能力。',
        implementationStatus: 'available',
      },
      {
        id: 'controlPlayback',
        toolName: 'netease_control_playback',
        title: '控制当前播放',
        description: '暂停、恢复或请求切换当前播放会话。',
        implementationStatus: 'available',
      },
    ],
  },
] as const satisfies readonly PhoneToolPackage[];

export function getPhoneToolPackageById(id: string): PhoneToolPackage | undefined {
  return PHONE_TOOL_PACKAGE_CATALOG.find((toolPackage) => toolPackage.id === id);
}
