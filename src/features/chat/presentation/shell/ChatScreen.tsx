/** 会话 Tab，只渲染会话列表；聊天详情与设置由独立 Router 页面承载。 */
import React, { useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationList, type ConversationListPinTarget } from '@features/assistants';
import type { PresentationTheme } from '@shared/theme';
import { useTheme, useThemedStyles } from '@shared/theme';
import { useChatRouter } from './ChatRouterContext';
import { useChatTextDrafts } from './ChatTextDraftProvider';

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.app,
  },
});

export default function ChatScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const {
    state,
    groupChats,
    unreadMessages,
    openConversation,
    openGroup,
    openCreateGroup,
    refreshConversations,
    setConversationPinned,
  } = useChatRouter();
  const { drafts } = useChatTextDrafts();
  const textDrafts = useMemo(() => Object.fromEntries([...drafts].map(([id, draft]) => [id, draft.text])), [drafts]);

  // 置顶只切换持久化事实；列表分区与分区内顺序由统一排序函数计算。
  const handleTogglePinned = useCallback(
    async (target: ConversationListPinTarget, pinned: boolean) => {
      await setConversationPinned(target, pinned);
    },
    [setConversationPinned],
  );

  return (
    <SafeAreaView
      style={styles.container}
      edges={theme.effects.glass.enabled ? ['bottom', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}
    >
      <ConversationList
        aiList={state.aiList}
        groupChats={groupChats}
        textDrafts={textDrafts}
        onSelectAI={openConversation}
        onSelectGroup={openGroup}
        onAddAI={state.handleAddAI}
        onCreateGroup={openCreateGroup}
        onTogglePinned={handleTogglePinned}
        onRefresh={refreshConversations}
        unreadMessages={unreadMessages}
      />
    </SafeAreaView>
  );
}
