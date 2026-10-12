# Assistants 与辅助模型资产

辅助模型中心创建、编辑、启停、删除和测试模型配置。每种能力首个配置可用后，Host 在同一事务中组合各 owner 的初始选择；后续新增不覆盖。AI 翻译与腾讯云的连接配置由 Assistants 作为资产管理，翻译参数契约、业务选择和调用归 Integrations。
配置列表路由为 `/auxiliary-models/capabilities/[kind]`，包含 embedding、OCR、STT、TTS、translation 五类资产；历史退休的 translate 占位类型不进入列表。

角色模型设置与已有辅助模型编辑自动保存：文字停止输入 1 秒或失焦提交，开关与选择立即提交。
角色模型、视觉辅助模型和群聊管理员的 Temperature / Top P 使用公共 `SliderField`；连续拖动本地预览，松手提交最终值，保留手动输入和字段错误提示。
角色模型的 Temperature / Top P 留空表示使用服务商默认值；输入框保持空白，轨道保留但不显示数值填充与滑块，仍可直接拖动设置数值。新角色与角色模型页的「重置为默认值」均将这两个参数留空，已有明确数值不自动改写。空值经过保存、重读、连接测试及各场景调用后仍不写入请求。
辅助模型和群聊管理员的同名参数遵循相同留空语义；OCR、表情识别与时刻图片理解不自行补充采样参数。
角色模型页提供「关闭思维链」：已支持的可切换思考模型在开关关闭时明确开启思考，开关开启时请求直接回答，不依赖服务商默认值。非思考模型保持原样；选择随角色持久保存，聊天、群聊、通话和主动任务使用相同配置。思考参数由 AI Platform 转换，固定思考模型仍受服务商能力限制。
用户输入在表单边界转换为增量命令，保存确认不回填正在编辑的草稿。
校验与写入错误在页面内展示；返回先提交，未保存错误可修正或恢复已保存值。新建辅助模型仍需明确点击「创建」。
输入、提交及页面生命周期契约见 [模型设置自动保存](../../../docs/architecture/model-settings-autosave.md)，行为验证为 `verify:model-settings-autosave`。
单聊对话设置维护名称、人设、头像、上下文可见条数与多气泡回复，沿用助手已有字段并独立自动保存；模型页只编辑调用配置，重置不影响对话上下文。助手头像命令只更新头像；通用草稿确认复用 shared/ui，契约见 [对话设置自动保存](../../../docs/architecture/conversation-settings-autosave.md)。

角色模型设置可弹窗选择角色 TTS，选择持久化于 `assistant_voice_settings`，用于该角色的语音消息和通话。新增角色在创建事务中初始化当前可用的首次 OCR 与 TTS 配置，之后独立更换或取消；任务解析不继承默认。

Memory、Chat、Speech、Integrations、Sticker 和 Moments 各自保存实际模型选择，只引用资产 ID，不复制连接信息与密钥。STT 列表直接嵌入 Speech 的语音识别模型选择控件；翻译列表嵌入 Integrations 的聊天翻译模型选择控件，AI 与腾讯云配置共用列表和选择。两者都在列表内选后立即保存，无单独设置页。
公开资产解析 `resolveAuxiliaryModel` 与选择投影 `getAuxiliaryModelSelection` 共用可用性规则，没有全局默认分支。
Host-only 的角色语音设置装配通过 composition 出口连接；UI 不直接访问 Repository。

首次资产 ID 与完成标记保存于 `auxiliary_model_initial_defaults`，由 Assistants 持有，删除资产不清空 marker。停用或未完成的首次配置暂不初始化，后续可用时只生效一次。升级保留已有业务选择，只为以后新角色记录最早创建的旧模型。

当前不变量、旧配置升级和备份恢复见 [模型选择架构](../../../docs/architecture/auxiliary-model-selection.md)。
