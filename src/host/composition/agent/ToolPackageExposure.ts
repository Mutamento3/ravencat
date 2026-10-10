/** Host 按用途冻结已授权工具；拆包只改变 schema 暴露，不改变执行权限。 */
import type { AgentTool, AgentToolExecutionResult } from '@shared/aiTools';
import type { AgentToolRegistry } from '@platform/agentRuntime';
import type { PromptToolInstructions } from '@shared/prompt';

export interface ToolPackageRuntimeBinding {
  packageId: string;
  tool: AgentTool;
}

const PACKAGE_DESCRIPTIONS: Record<string, { title: string; whenToUse: string }> = {
  webTools: { title: '联网工具包', whenToUse: '搜索公开信息、读取网页正文，或将公开链接中的文件下载到手机。' },
  protocol: { title: '协议空间', whenToUse: '查找、新增、修改或删除当前 AI 常驻注入的提示词与信息；正文已注入，仅阅读无需拆包。' },
  moments: { title: '时刻互动', whenToUse: '浏览或搜索可见时刻、读取详情与未读社交待办；发布文本时刻、评论或回复、点赞或取消，以及撤回自己的时刻或评论。' },
  wallet: { title: '羽库记账', whenToUse: '用户告知收支时主动记账；查询账单与统计、搜索定位、编辑或删除记录。金额不明确先询问。' },
  calls: { title: '通话', whenToUse: '想实时交流时可主动向用户发起来电邀请；视频通话中可按需查看用户当前画面。' },
  memory: { title: '长期记忆', whenToUse: '主动检索当前 AI 的长期记忆，或保存、修正、删除记忆；用于历史资料，不是常驻提示词。' },
  assistants: { title: 'AI 管理', whenToUse: '拉黑或解除拉黑其他 AI。' },
  deviceControl: { title: '手机应用操作', whenToUse: '搜索本机可启动应用、打开指定应用，或为应用设置限时软锁、解除软锁。' },
  phoneTools: { title: '手机使用情况', whenToUse: '查询当前前台应用及受保护状态，或应用前台使用时长；页面内容由手机屏幕读取包提供。' },
  screenCapture: { title: '手机屏幕读取', whenToUse: '通过无障碍读取当前页面文字与界面结构，或截图后用本地 OCR 读取可见文字；不理解非文字画面，不操作界面。' },
  companion: { title: '自主唤醒与日程', whenToUse: '安排未来自主唤醒，可自行决定或回应用户要求；浏览、读取、修改或取消自己的 AI 日程。到点按最新上下文决定行动。' },
  chat: { title: '消息与语音', whenToUse: '可自主选择向用户发送语音；旁路运行需要主动联系用户时发送普通消息。' },
  stickers: { title: '表情包', whenToUse: '用自然语言搜索或按分组浏览表情包，选择作为回复发送；可自主用来表达反应或情绪。' },
  togetherListening: { title: '一起听', whenToUse: '邀请用户一起听网易云音乐、接受或拒绝用户邀请，或结束一起听；选歌与播放控制由网易云音乐包提供。' },
  neteaseMusic: { title: '网易云音乐', whenToUse: '搜索歌曲或公开歌单、读取歌单与歌词、解析分享链接；播放指定歌曲、查询播放状态，或暂停、恢复、切歌。' },
};

export const OPEN_TOOL_PACKAGE_NAME = 'open_tool_package';

export function registerToolPackagesForHostRun(input: {
  registry: AgentToolRegistry;
  allowedToolNames: readonly string[];
  bindings: readonly ToolPackageRuntimeBinding[];
  openPackageIds: readonly string[];
  directToolNames?: readonly string[];
}): {
  packageToolNames: string[];
  metaToolNames: string[];
  visibleToolNames: () => string[];
  instructions: () => PromptToolInstructions;
} {
  const allowed = new Set(input.allowedToolNames);
  const packages = new Map<string, AgentTool[]>();
  for (const { packageId, tool } of input.bindings) {
    if (!allowed.has(tool.descriptor.name)) continue;
    if (!PACKAGE_DESCRIPTIONS[packageId]) throw new Error(`工具包缺少用途描述：${packageId}`);
    const tools = packages.get(packageId);
    if (tools) tools.push(tool);
    else packages.set(packageId, [tool]);
  }
  // 特批仅从本次已授权集合中选出；偏好不能扩大 task 的调用权限。
  const directNames = new Set(input.directToolNames ?? []);
  const directTools = [...packages.values()].flat().filter((tool) => directNames.has(tool.descriptor.name));
  const packedTools = new Map<string, AgentTool[]>();
  for (const [id, tools] of packages) {
    const remaining = tools.filter((tool) => !directNames.has(tool.descriptor.name));
    if (remaining.length > 0) packedTools.set(id, remaining);
  }
  const openIds = new Set(input.openPackageIds.filter((id) => packedTools.has(id)));
  const directCatalog = directTools.length === 0 ? '' : [
    '【用户特批工具】',
    '用户指定以下工具常驻暴露，无需 open_tool_package 即可直接调用；用途与参数见当前 function schema，特批不改变调用权限与场景身份限制。',
    ...directTools.map(({ descriptor }) => JSON.stringify({ name: descriptor.name })),
  ].join('\n');
  // 用途目录由本次冻结的授权与特批配置决定；拆包不删除简介，保持缓存前缀。
  // 目录只提供选包线索；逐工具说明由 schema 唯一提供，避免展开后重复注入。
  const packageCatalog = packedTools.size === 0 ? '' : [
    '【本次运行的工具包用途目录】',
    '以下按包概括用途，tools 仅列出本次已授权且需拆包的工具名，不表示包已展开；需要时用 open_tool_package 拆开（拆包不增加权限），具体工具用途与参数见展开后的 function schema。',
    '普通单聊中，新拆开的包在正式回复提交后保留后续三轮用户与 AI 对话；工具调用、思维链和消息分段不额外计轮。',
    ...[...packedTools].map(([id, tools]) => JSON.stringify({
      id, ...PACKAGE_DESCRIPTIONS[id],
      tools: tools.map(({ descriptor }) => descriptor.name),
    })),
  ].join('\n');
  const catalog = [directCatalog, packageCatalog].filter(Boolean).join('\n\n');
  if (packedTools.size > 0) {
    input.registry.register({
      descriptor: {
        name: OPEN_TOOL_PACKAGE_NAME,
        description: '按用途拆开一个工具包；下一次请求起直接提供包内工具与完整参数。可拆开多个；已展开的无需重复拆开。',
        inputSchema: {
          type: 'object',
          properties: { package_id: { type: 'string', enum: [...packedTools.keys()], description: '可用工具包 ID' } },
          required: ['package_id'],
          additionalProperties: false,
        },
        owner: 'host:tool-packages', source: 'local', risk: 'safe_read', idempotency: 'idempotent',
      },
      async execute(value): Promise<AgentToolExecutionResult<unknown>> {
        const { package_id: id } = value as { package_id: string };
        // 参数已通过 Runtime 的模型输出边界校验；这里信任 enum 契约。
        const alreadyOpen = openIds.has(id);
        openIds.add(id);
        return {
          status: 'success',
          data: { packageId: id },
          modelContent: alreadyOpen
            ? `工具包 ${id} 已展开，无需重复拆开，参数以 function schema 为准。`
            : `工具包 ${id} 已拆开。下一次模型请求将直接提供包内工具与完整参数；本轮可立即继续调用。`,
          ...(alreadyOpen ? {} : { metadata: { openedToolPackageId: id } }),
        };
      },
    });
  }
  return {
    packageToolNames: [...packages.values()].flatMap((tools) => tools.map(({ descriptor }) => descriptor.name)),
    metaToolNames: packedTools.size > 0 ? [OPEN_TOOL_PACKAGE_NAME] : [],
    visibleToolNames: () => [
      ...directTools.map(({ descriptor }) => descriptor.name),
      ...[...packedTools].flatMap(([id, tools]) => (
        openIds.has(id) ? tools.map(({ descriptor }) => descriptor.name) : []
      )),
    ],
    instructions: () => ({
      catalog,
      state: packedTools.size === 0 ? '' : [
        '【本轮工具包展开状态】',
        'open 的包无需重复拆开；包内工具仍须以当前 function schema 为准。',
        ...[...packedTools.keys()].map((id) => JSON.stringify({ id, state: openIds.has(id) ? 'open' : 'closed' })),
      ].join('\n'),
    }),
  };
}
