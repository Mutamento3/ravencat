/** AI 逐步选择语义工具；原生只执行当前步骤并返回现场页面，不承包整段发布。 */
import { runAsCurrentHostAuthority } from '@features/assistants';
import { executeXiaohongshuNote, type XiaohongshuNoteCommand } from '@platform/device';
import type { Tool, ToolContext, ToolDefinition, ToolExecuteResult } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { loadCurrentProtectedPackages } from '../application/CurrentProtectedAppsPolicy';
import { assertProtectedAppCapabilityAllowed, ProtectedAppsPolicyError } from '../application/ProtectedAppsPolicy';

async function execute(command: XiaohongshuNoteCommand, context: ToolContext): Promise<ToolExecuteResult> {
  const actor = context.getAIId();
  if (!actor) return { success: false, error: 'missing_actor_ai_id: 未识别到当前 AI 身份' };
  try {
    const authority = await runAsCurrentHostAuthority(actor, async () => {
      assertProtectedAppCapabilityAllowed('com.xingin.xhs', await loadCurrentProtectedPackages(),
        command.operation === 'get_page' ? 'observation' : 'action');
      throwIfAbortSignalAborted(context.abortSignal);
      return executeXiaohongshuNote(actor, command, context.abortSignal);
    });
    if (authority.status === 'not_current_host') return { success: false, error: 'not_current_host: 当前 AI 已不是主理 AI' };
    const result = authority.value;
    if (result.status === 'not_completed' || result.status === 'publish_outcome_unknown') {
      const guidance = result.publishAttempted
        ? '发布已经尝试，禁止自动重试或重新准备发布；只能只读确认页面，仍无法确认时请用户检查发布结果。'
        : '本步骤未确认完成，不代表动作未生效。先依据当前页面和 availableActions 决策，页面不可读时只读确认页面；工具不会自动重试，非发布步骤允许你在确认现场后重新调用。';
      // Legacy adapter 的失败只把 error 交给模型，页面事实必须进入 error，不能只放在 data。
      return { success: false, errorCode: result.status,
        error: `${result.status}: ${result.reason}。${guidance}\n${JSON.stringify(result)}`, data: result };
    }
    return { success: true, message: JSON.stringify(result), data: result };
  } catch (error) {
    if (!(error instanceof ProtectedAppsPolicyError)) throw error;
    return { success: false, error: `protected_app: ${error.message}` };
  }
}

const noArgs = { type: 'object', properties: {}, additionalProperties: false } as const;
function stepTool<Args>(name: string, description: string, parameters: ToolDefinition['parameters'], command: (args: Args) => XiaohongshuNoteCommand): Tool<Args, ToolContext> {
  return { name, definition: { name, description, parameters }, execute: (args, context) => execute(command(args), context) };
}
function textField(maxLength: number, description: string): ToolDefinition['parameters'] {
  return { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength, description } }, required: ['text'], additionalProperties: false };
}

export const XiaohongshuGetPageTool = stepTool('xiaohongshu_get_page',
  '只读确认当前前台包名、小红书页面类型、键盘状态、输入字段摘要及可执行步骤。随时可调用，包括失败后；窗口不可靠与页面不匹配分别报告。不会点击，不读取其他应用页面。', noArgs, () => ({ operation: 'get_page' }));
export const XiaohongshuEnterPublishingTool = stepTool('xiaohongshu_enter_publishing',
  '从小红书主页面点击发布入口，只停在从相册选择/写文字的创作菜单，返回实际页面。部分机型与版本适配，不自动执行后续步骤。', noArgs, () => ({ operation: 'enter_publishing' }));
export const XiaohongshuOpenTextEntryTool = stepTool('xiaohongshu_open_text_entry',
  '在创作菜单选择写文字，停在写想法/写长文分叉页，返回实际页面。下一步应调用 start_text_note 走文字卡片路线。', noArgs, () => ({ operation: 'open_text_entry' }));
export const XiaohongshuStartTextNoteTool = stepTool('xiaohongshu_start_text_note',
  '在写想法/写长文分叉页选择写想法，进入文字卡片输入页。不选择写长文，返回当前页面。', noArgs, () => ({ operation: 'start_text_note' }));
export const XiaohongshuSetCardTextTool = stepTool<{ text: string }>('xiaohongshu_set_card_text',
  '在写想法的文字卡片输入页整体设置卡片文字，保留换行；确认文字后返回页面，不生成卡片、不发布。可重新设置。', textField(300, '卡片文字'), args => ({ operation: 'set_card_text', text: args.text }));
export const XiaohongshuSetTitleTool = stepTool<{ text: string }>('xiaohongshu_set_title',
  '在笔记编辑页整体设置标题，确认后返回当前页面。可重新设置。', textField(20, '笔记标题'), args => ({ operation: 'set_title', text: args.text }));
export const XiaohongshuSetBodyTool = stepTool<{ text: string }>('xiaohongshu_set_body',
  '在笔记编辑页整体替换正文，确认后返回当前页面。应先写正文再加话题；重新写正文会清掉原有话题格式，需要重新添加话题。', textField(500, '笔记正文，话题通过单独工具逐个添加'), args => ({ operation: 'set_body', text: args.text }));
export const XiaohongshuAddTopicTool = stepTool<{ tag: string }>('xiaohongshu_add_topic',
  '在笔记编辑页只添加一个精确话题，返回本次结果和当前页面；不批量操作。会覆盖系统剪贴板，不保存或恢复原内容；已存在的同名话题不重复粘贴。',
  { type: 'object', properties: { tag: { type: 'string', minLength: 1, maxLength: 20, pattern: '^[^\\s#]+$', description: '单个话题名称，不含 # 或空白，保留大小写' } }, required: ['tag'], additionalProperties: false },
  args => ({ operation: 'add_topic', tag: args.tag }));
export const XiaohongshuSelectStyleTool = stepTool<{ slot: number }>('xiaohongshu_select_style',
  '在文字卡片样式预览页选择当前可见的前五个样式槽位之一，返回确认结果；名称可能变化。已选中时不重复点击换搭配。',
  { type: 'object', properties: { slot: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['slot'], additionalProperties: false },
  args => ({ operation: 'select_style', slot: args.slot }));
export const XiaohongshuSetVisibilityTool = stepTool<{ visibility: 'public' | 'private' }>('xiaohongshu_set_visibility',
  '在笔记编辑页设置公开可见或仅自己可见，确认后返回当前页面，不发布。可重新设置。',
  { type: 'object', properties: { visibility: { type: 'string', enum: ['public', 'private'] } }, required: ['visibility'], additionalProperties: false },
  args => ({ operation: 'set_visibility', visibility: args.visibility }));
export const XiaohongshuNextTool = stepTool('xiaohongshu_next',
  '仅在卡片输入或样式预览页点击一次下一步，返回实际到达的页面；应用可能跳过预览直接进入笔记编辑，必须依据返回页面选择下一步，不重复补点，不会点击发布。', noArgs, () => ({ operation: 'next' }));
export const XiaohongshuGoBackTool = stepTool('xiaohongshu_go_back',
  '在小红书创作页面只返回一次，页面未识别时也可显式调用；键盘打开时先收起键盘。返回当前页面；遇到存草稿/不保存返回确认时停下交给用户，不擅自丢弃编辑。不操作其他前台应用。', noArgs, () => ({ operation: 'back' }));
export const XiaohongshuPreparePublishTool = stepTool('xiaohongshu_prepare_publish',
  '在键盘收起的待发布页只读核对笔记并取得十分钟内有效的一次性 draft_id，不点击发布。可停在这里让用户检查；修改内容或返回后需要重新取得凭据。', noArgs, () => ({ operation: 'prepare_publish' }));
export const XiaohongshuPublishPreparedNoteTool = stepTool<{ draft_id: string }>('xiaohongshu_publish_prepared_note',
  '消费本 AI 的一次性 draft_id，只尝试一次发布。结果不确定时禁止自动重试或重新准备发布，须人工检查。',
  { type: 'object', properties: { draft_id: { type: 'string', minLength: 1 } }, required: ['draft_id'], additionalProperties: false },
  args => ({ operation: 'publish', draft_id: args.draft_id }));
