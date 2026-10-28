/** 对话资料、上下文与气泡设置自动保存，背景组件保持各自的提交流程。 */
// 对话设置页面 - 主组件（组装层）

import React from 'react';
import {
  Text,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import NavigationHeader from '@shared/ui/NavigationHeader';
import { AIInfoCard, BackgroundPickerCard, InputField, KeyboardAvoidingContainer, ToggleField } from '@shared/ui';
import { AutoSaveErrors } from '@shared/ui/AutoSaveErrors';
import useChatSettings from './useChatSettings';
import { createStyles } from './chatSettingsStyles';
import { getChatInteractionProfile, ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import { createCommonStyles } from '@shared/ui/commonStyles';
import { ContextLimitsApply, type AIProfile } from '@features/assistants';
import ChatWallpaperSettings from '../messages/components/ChatWallpaperSettings';
import ContextWindowSection from './ContextWindowSection';
import FixedChatContextSection from './FixedChatContextSection';
import HistoricalGroupsSection from './HistoricalGroupsSection';
import { CallRingtoneSettings } from '@features/calls';

interface ChatSettingsProps {
  aiAssistant: AIProfile;
  conversationId: string;
  onChooseFixedStart(): void;
  chatBackgroundKey?: string | null;
  onBack?: (updatedAI?: Partial<AIProfile>) => void;
  onUpdated?: (updatedAI: Partial<AIProfile>) => void;
}

/**
 * 对话设置页面主组件
 * @param aiAssistant - 当前 AI 助手数据
 * @param onBack - 返回回调
 * @param onUpdated - 更新成功回调
 */
export default function ChatSettings({ aiAssistant, conversationId, onChooseFixedStart, chatBackgroundKey, onBack, onUpdated }: ChatSettingsProps) {
  const [fixed, setFixed] = React.useState(false);
  const theme = useTheme();
  const interactionProfile = getChatInteractionProfile(theme);
  const canUseMultipleBubbles = interactionProfile.enableAssistantMessageSegmentation;
  const styles = useThemedStyles(createStyles);
  const commonStyles = React.useMemo(() => createCommonStyles(theme), [theme]);

  const {
    // 表单字段
    name,
    setName,
    nickname,
    setNickname,
    nicknameError,
    systemPrompt,
    setSystemPrompt,
    contextLimits,
    handleContextLimitChange,
    allowMultipleBubbles,
    setAllowMultipleBubbles,
    streamingReply,
    setStreamingReply,
    showTokenUsage,
    setShowTokenUsage,
    showActionSteps,
    setShowActionSteps,
    settingsErrors,
    avatarUrl,
    callBackgroundUri,

    // 状态
    isLoading,

    // handlers
    handleAvatarPress,
    handlePickCallBackground,
    handleClearCallBackground,
    nameError, infoSaveError, avatarError, blocked, commit, flush, back, leave, restoreInfo, restoreAvatar, retryAvatar,
  } = useChatSettings({ aiAssistant, onBack, onUpdated });

  return (
    <SafeAreaView style={commonStyles.screenContainer} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingContainer style={commonStyles.screenContainer}>
        <NavigationHeader
          title="对话设置"
          onGoBack={back}
          help={{ sections: [
            { title: '保存与生效范围', body: '设置仅对这位 AI 生效。名称、昵称、人设与条数在离开输入框后自动保存，开关立即保存。昵称最多 20 个字符，是你对这位 AI 的备注，不影响它的公开名称；留空恢复显示公开名称。人设与提示词中心同步，留空可清除。' },
            { title: '上下文条数', body: '当前单聊与当前群聊的条数必须为正整数；两项背景条数允许为 0，也可大于当前对话条数。群聊额度按每个群独立计算。' },
            { title: '跨对话背景', body: '单聊会带入当前单聊和已参加群的背景；群聊会带入单聊背景、当前群聊和其他已参加群的背景。背景条数为 0 时，该类来源的原文与摘要都不带入，但不停止来源生成摘要；正数限制近期原文，摘要另由各来源的注入开关控制。' },
            { title: '摘要与近期原文', body: '单聊按当前单聊条数触发摘要，群聊按群摘要设置触发。自动摘要成功前保留尚未处理的原文；关闭生成后按近期条数读取。' },
            { title: '固定消息起点', body: '点击选择起点后，在消息列表长按某条消息并选择「固定」。从该消息到最新的全部原文都会带入，当前单聊条数暂不生效，自动生成摘要暂停。已有摘要是否带入仍由摘要页面控制。取消或删除起点后恢复近期条数；生成摘要需手动重新开启。' },
            { title: '回复显示', body: '流式输出从下一轮回复生效；与多气泡同时开启时，会在自然分段处继续下一泡。多气泡按空行和句长分段，表达风格由人设和提示词决定。行动步骤包含思考、工具状态与自主活动过程；Token 用量包含输入、输出和缓存信息。两项显隐只改变展示，不影响模型调用或消息存档。' },
            { title: '历史群聊', body: '退出或被移除时保存的历史不会接收后续群消息。可在历史群聊中查看和开关自动带入，也可以让 AI 使用记忆工具转存为长期记忆。' },
          ] }}
        />

        <ScrollView style={commonStyles.screenContainer} showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {/* AI 信息卡片 */}
          <ThemedSurface variant="card" style={styles.aiCard}>
            <AIInfoCard
              name={nickname.trim() || name}
              model={aiAssistant.model}
              avatarUrl={avatarUrl}
              size="large"
              onAvatarPress={handleAvatarPress}
            />
          </ThemedSurface>
          <AutoSaveErrors error={avatarError} blocked={false} retry={retryAvatar} restore={() => void restoreAvatar()} />

          {/* 表单区域 */}
          <Text style={styles.sectionLabel}>基本信息</Text>
          <ThemedSurface variant="card" style={styles.formSection}>

            {/* AI名称 */}
            <InputField
              label="AI 名称"
              value={name}
              onChangeText={setName}
              onBlur={() => void commit()}
              error={nameError}
              placeholder="给 AI 起个名字（最多 20 字）"
              maxLength={20}
            />
            <InputField
              label="专属昵称"
              value={nickname}
              onChangeText={setNickname}
              onBlur={() => void commit()}
              error={nicknameError}
              placeholder="你的专属称呼，留空使用 AI 名称"
            />
            <InputField
              label="AI 人设"
              value={systemPrompt}
              onChangeText={setSystemPrompt}
              onBlur={() => void commit()}
              placeholder="写下 AI 的身份、性格、关系与表达方式"
              autoGrow
              style={styles.lastField}
              textAlignVertical="top"
            />
          </ThemedSurface>

          <Text style={styles.sectionLabel}>聊天上下文</Text>
          <ContextWindowSection
            values={contextLimits}
            onChange={handleContextLimitChange}
            onBlur={() => void commit()}
            errors={settingsErrors}
            fixed={fixed}
          >
            <ContextLimitsApply readSettings={async () => {
              if (!await flush()) return null;
              return { privateContextPrimaryLimit: Number(contextLimits.privatePrimary), privateContextSecondaryLimit: Number(contextLimits.privateSecondary),
                groupContextPrimaryLimit: Number(contextLimits.groupPrimary), groupContextSecondaryLimit: Number(contextLimits.groupSecondary) };
            }} />
          </ContextWindowSection>
          <FixedChatContextSection conversationId={conversationId} onFixedChange={setFixed}
            onChoose={() => { void leave(onChooseFixedStart); }} />
          <HistoricalGroupsSection assistantId={aiAssistant.id} />

          {/* 气泡数量只影响客户端自动分段，不改变聊天输出格式要求。 */}
          <Text style={styles.sectionLabel}>回复显示</Text>
          <ThemedSurface variant="card" style={styles.toggleCard}>
            <ToggleField
              layout="inline"
              style={styles.toggleRow}
              label="流式输出"
              hint="边生成边显示 · 下一轮回复生效"
              value={streamingReply ?? interactionProfile.preferStreamingReply}
              onValueChange={setStreamingReply}
            />
            <ToggleField
              layout="inline"
              style={styles.toggleRow}
              label="允许多气泡回复"
              hint={canUseMultipleBubbles
                ? '按自然段落拆分，可与流式同时开启'
                : '当前主题使用单气泡，仍会保留此选择'}
              value={allowMultipleBubbles}
              onValueChange={setAllowMultipleBubbles}
            />
            <ToggleField
              layout="inline"
              style={styles.toggleRow}
              label="显示行动步骤"
              hint="查看思考与工具执行过程"
              value={showActionSteps}
              onValueChange={setShowActionSteps}
            />
            <ToggleField
              layout="inline"
              style={styles.lastToggleRow}
              label="显示 Token 用量"
              hint="在回复下方查看消耗与缓存命中"
              value={showTokenUsage}
              onValueChange={setShowTokenUsage}
            />
          </ThemedSurface>
          <AutoSaveErrors error={infoSaveError} blocked={blocked && Object.keys(settingsErrors).length > 0}
            retry={() => void flush()} restore={() => void restoreInfo()} />

          <Text style={styles.sectionLabel}>背景</Text>
          <ChatWallpaperSettings chatKey={chatBackgroundKey} style={styles.backgroundCard} />

          {/* 通话背景 */}
          <BackgroundPickerCard
            style={styles.backgroundCard}
            title="通话背景"
            description="这位 AI 的专属通话背景"
            previewSource={callBackgroundUri ? { uri: callBackgroundUri } : null}
            previewFallbackColor={theme.colors.chat.screen}
            previewTitle={callBackgroundUri ? '自定义通话背景' : '默认通话背景'}
            previewSubtitle={callBackgroundUri ? '已选择自定义图片' : '使用系统默认背景'}
            isPicking={isLoading}
            resetDimmed={!callBackgroundUri}
            onPick={handlePickCallBackground}
            onReset={handleClearCallBackground}
          />
          <Text style={styles.sectionLabel}>通话铃声</Text>
          <CallRingtoneSettings assistantId={aiAssistant.id} />
        </ScrollView>
      </KeyboardAvoidingContainer>
    </SafeAreaView>
  );
}
