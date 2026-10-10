/** 对话展示信息自动保存，背景组件保持各自的提交流程。 */
// 对话设置页面 - 主组件（组装层）

import React from 'react';
import {
  View,
  Text,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import NavigationHeader from '@shared/ui/NavigationHeader';
import { AIInfoCard, BackgroundPickerCard, InputField } from '@shared/ui';
import { AutoSaveErrors } from '@shared/ui/AutoSaveErrors';
import useChatSettings from './useChatSettings';
import { createStyles } from './chatSettingsStyles';
import { useTheme, useThemedStyles } from '@shared/theme';
import { createCommonStyles } from '@shared/ui/commonStyles';
import type { AIProfile } from '@features/assistants';
import ChatWallpaperSettings from '../messages/components/ChatWallpaperSettings';

interface ChatSettingsProps {
  aiAssistant: AIProfile;
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
export default function ChatSettings({ aiAssistant, chatBackgroundKey, onBack, onUpdated }: ChatSettingsProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const commonStyles = React.useMemo(() => createCommonStyles(theme), [theme]);

  const {
    // 表单字段
    name,
    setName,
    systemPrompt,
    setSystemPrompt,
    avatarUrl,
    callBackgroundUri,

    // 状态
    isLoading,

    // handlers
    handleAvatarPress,
    handlePickCallBackground,
    handleClearCallBackground,
    nameError, infoSaveError, avatarError, blocked, flush, back, restoreInfo, restoreAvatar, retryAvatar,
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
            name={name}
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
            onBlur={() => void flush()}
            error={nameError}
            placeholder="给AI起个名字"
            hint="最多20个字符"
            maxLength={20}
          />
          <InputField
            label="AI 人设"
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            onBlur={() => void flush()}
            placeholder="写下 AI 的身份、性格、关系与表达方式"
            hint="修改自动保存，提示词中心同步显示；留空可清除人设。"
            autoGrow
            textAlignVertical="top"
          />
          <AutoSaveErrors error={infoSaveError} blocked={blocked && !!nameError}
            retry={() => void flush()} restore={() => void restoreInfo()} />

        </View>

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
