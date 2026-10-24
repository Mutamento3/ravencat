/** 对话资料、上下文与气泡设置自动保存，背景组件保持各自的提交流程。 */
// 对话设置页面 - 主组件（组装层）

import React from 'react';
import {
  View,
  Text,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import NavigationHeader from '@shared/ui/NavigationHeader';
import { AIInfoCard, BackgroundPickerCard, InputField, ToggleField } from '@shared/ui';
import { AutoSaveErrors } from '@shared/ui/AutoSaveErrors';
import useChatSettings from './useChatSettings';
import { createStyles } from './chatSettingsStyles';
import { getChatInteractionProfile, useTheme, useThemedStyles } from '@shared/theme';
import { createCommonStyles } from '@shared/ui/commonStyles';
import { ContextLimitsApply, type AIProfile } from '@features/assistants';
import ChatWallpaperSettings from '../messages/components/ChatWallpaperSettings';
import ContextWindowSection from './ContextWindowSection';
import FixedChatContextSection from './FixedChatContextSection';
import HistoricalGroupsSection from './HistoricalGroupsSection';

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
      <NavigationHeader
        title="对话设置"
        onGoBack={back}
      />

      <ScrollView style={commonStyles.screenContainer} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {/* AI 信息卡片 */}
        <View style={styles.aiCard}>
          <AIInfoCard
            name={nickname.trim() || name}
            model={aiAssistant.model}
            avatarUrl={avatarUrl}
            size="large"
            onAvatarPress={handleAvatarPress}
          />
        </View>
        <AutoSaveErrors error={avatarError} blocked={false} retry={retryAvatar} restore={() => void restoreAvatar()} />

        {/* 表单区域 */}
        <View style={styles.formSection}>
          <Text style={commonStyles.sectionTitle}>基本信息</Text>

          {/* AI名称 */}
          <InputField
            label="AI名称"
            value={name}
            onChangeText={setName}
            onBlur={() => void commit()}
            error={nameError}
            placeholder="给AI起个名字"
            hint="最多20个字符"
            maxLength={20}
          />
          <InputField
            label="AI昵称"
            value={nickname}
            onChangeText={setNickname}
            onBlur={() => void commit()}
            error={nicknameError}
            placeholder="给这个AI设置专属昵称"
            hint="最多20个字符"
          />
          <InputField
            label="AI 人设"
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            onBlur={() => void commit()}
            placeholder="写下 AI 的身份、性格、关系与表达方式"
            hint="修改自动保存，提示词中心同步显示；留空可清除人设。"
            autoGrow
            textAlignVertical="top"
          />
        </View>

        <ContextWindowSection
          values={contextLimits}
          onChange={handleContextLimitChange}
          onBlur={() => void commit()}
          errors={settingsErrors}
          fixed={fixed}
        />
        <HistoricalGroupsSection assistantId={aiAssistant.id} />
        <ContextLimitsApply readSettings={async () => {
          if (!await flush()) return null;
          return { privateContextPrimaryLimit: Number(contextLimits.privatePrimary), privateContextSecondaryLimit: Number(contextLimits.privateSecondary),
            groupContextPrimaryLimit: Number(contextLimits.groupPrimary), groupContextSecondaryLimit: Number(contextLimits.groupSecondary) };
        }} />
        <FixedChatContextSection conversationId={conversationId} onFixedChange={setFixed}
          onChoose={() => { void leave(onChooseFixedStart); }} />

        {/* 气泡数量只影响客户端自动分段，不改变聊天输出格式要求。 */}
        <View style={styles.settingsSection}>
          <ToggleField
            label="流式输出"
            hint="开启后文字逐步显示；允许多气泡时，会在自然分段处接着下一泡输出。仅影响这个 AI 的单聊，从下一轮回复生效。"
            value={streamingReply ?? interactionProfile.preferStreamingReply}
            onValueChange={setStreamingReply}
          />
          <ToggleField
            label="允许多气泡回复"
            hint={canUseMultipleBubbles
              ? '开启后按空行和句长自动分泡，流式时边生成边分泡；表达风格仍由人设和提示词决定。'
              : '当前主题实际使用单气泡；你的多气泡原设置会保留，切回支持主题后恢复。'}
            value={allowMultipleBubbles}
            onValueChange={setAllowMultipleBubbles}
          />
          <ToggleField
            label="显示行动步骤"
            hint="显示思维链与工具执行过程；仅影响这个 AI 的单聊展示，所有主题通用。"
            value={showActionSteps}
            onValueChange={setShowActionSteps}
          />
          <ToggleField
            label="显示 Token 用量"
            hint="在回复下方显示输入、输出、缓存命中数量与命中率；仅影响这个 AI 的单聊展示，所有主题通用。"
            value={showTokenUsage}
            onValueChange={setShowTokenUsage}
          />
        </View>
        <AutoSaveErrors error={infoSaveError} blocked={blocked && Object.keys(settingsErrors).length > 0}
          retry={() => void flush()} restore={() => void restoreInfo()} />

        <ChatWallpaperSettings chatKey={chatBackgroundKey} />

        {/* 通话背景 */}
        <BackgroundPickerCard
          style={styles.callBackgroundSection}
          title="通话背景"
          description="仅为这个 AI 的通话设置背景，不影响其他角色"
          previewSource={callBackgroundUri ? { uri: callBackgroundUri } : null}
          previewFallbackColor={theme.colors.chat.screen}
          previewTitle={callBackgroundUri ? '自定义通话背景' : '默认通话背景'}
          previewSubtitle={callBackgroundUri ? '已选择自定义图片' : '使用系统默认背景'}
          isPicking={isLoading}
          resetDimmed={!callBackgroundUri}
          onPick={handlePickCallBackground}
          onReset={handleClearCallBackground}
        />

      </ScrollView>
    </SafeAreaView>
  );
}
