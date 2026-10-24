/** 在聊天路由栈间共享会话状态，避免每个路由重复挂载消息列表。 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { AIProfile } from '@features/assistants';
import type { ChatCallSession } from '../../conversation/application/ChatCallGateway';
import type { ConversationKind } from '../../conversation/domain/ConversationRef';
import type { GroupChat, GroupChatDetails } from '../../group/domain/GroupChat';
import { listGroupChats, updateGroupChatPinned } from '../../group/application';
import { getCanonicalChatConversation } from '../../conversation/application/ChatPresentation';
import { withArrivedConversationPreview } from './arrivedConversationPreview';
import { getAssistantMessageArrivalSnapshot } from '../../reply/delivery/AssistantMessageArrival';
import { setChatEventBus } from '../../messages/events/ChatEvents';
import { setDirectConversationPinned } from '../../conversation/application/ConversationPin';
import {
  buildConversationPreloadCandidates,
  filterRunnableConversationPreloadCandidates,
  resolveConversationPreloadFreshnessChanges,
  resolveConversationPreloadHotSet,
  type ConversationPreloadFreshnessSnapshot,
} from './conversationPreloadCandidates';
import { clearSessionTimelineCache } from '../messages/components/sessionTimelineCache';
import {
  createConversationPreparationController,
  type ConversationPreparationSnapshot,
  type EnsureConversationResult,
} from './ConversationPreparationController';
import type { ChatSubScreen, FilePreviewParams, GroupChatSubScreen } from './chatScreenTypes';
import useChatScreen from './useChatScreen';
import { 
  markConversationListFailed,
  markConversationListReady,
} from '@shared/runtime/ConversationListReadySignal';
import {
  DEFAULT_USER_PROFILE,
  getCurrentUserProfile,
  subscribeUserProfileUpdated,
  type UserProfile,
} from '@features/profile';

interface ActiveChatContext {
  ownerId: string;
  releaseOwner?: boolean;
  aiId: string | null;
  sessionId: string | null;
  isChatVisible: boolean;
  /** 前台会话类型：单聊为 'direct' 或缺省，群聊路由上报 'group' */
  conversationKind?: ConversationKind;
  /** 前台群聊的 groupId */
  groupId?: string | null;
}

export interface ChatRouterProviderProps {
  children: ReactNode;
  onAddAI?: (() => void) | null;
  onActiveChatContextChange?: ((context: ActiveChatContext) => void) | null;
  sessionRefreshTrigger?: number;
  unreadMessages?: Record<string, number>;
  onConversationViewed?: ((aiId: string) => void) | null;
  dbReady?: boolean;
  conversationListLoadEnabled?: boolean;
  onCallCreated?: (call: ChatCallSession) => void;
  onOpenConversation: (aiId: string) => void;
  onOpenGroup: (groupId: string) => void;
  onOpenGroupFilePreview: (groupId: string) => void;
  onOpenGroupSubScreen: (groupId: string, screen: GroupChatSubScreen) => void;
  onGroupCreated: (groupId: string) => void;
  onOpenCreateGroup: () => void;
  onOpenSubScreen: (aiId: string, screen: ChatSubScreen) => void;
  onOpenPromptCenter: (assistantId?: string) => void;
  onRouteBack: () => void;
  onReturnToConversation: (aiId: string) => void;
  onReturnToConversations: () => void;
  onResetApplicationData: () => Promise<void>;
}

type ChatState = ReturnType<typeof useChatScreen>;

interface ChatRouterContextValue {
  state: ChatState;
  groupChats: GroupChat[];
  currentGroup: GroupChat | null;
  currentUser: UserProfile;
  currentUserReady: boolean;
  unreadMessages: Record<string, number>;
  onCallCreated?: (call: ChatCallSession) => void;
  /** 获得焦点的具体聊天路由上报前台会话上下文。 */
  onActiveChatContextChange?: ((context: ActiveChatContext) => void) | null;
  openConversation: (ai: AIProfile) => void;
  ensureConversation: (
    aiId: string,
    sessionId?: string | null
  ) => Promise<EnsureConversationResult>;
  refreshConversations: () => Promise<void>;
  /** 群聊会话列表事实（preview / 顺序）重读。 */
  refreshGroupChats: () => Promise<GroupChat[]>;
  /** 切换会话列表置顶；direct / group 共用同一入口。 */
  setConversationPinned: (
    target: { kind: ConversationKind; id: string },
    pinned: boolean,
  ) => Promise<void>;
  openGroup: (group: GroupChat) => void;
  openGroupFilePreview: (groupId: string, params: FilePreviewParams) => void;
  openGroupSubScreen: (groupId: string, screen: GroupChatSubScreen) => void;
  ensureGroup: (groupId: string) => Promise<boolean>;
  groupCreated: (details: GroupChatDetails) => void;
  groupDeleted: (groupId: string) => void;
  groupUpdated: (group: GroupChat) => void;
  openCreateGroup: () => void;
  openSubScreen: (screen: ChatSubScreen) => void;
  routeBack: () => void;
  returnToConversation: (aiId: string) => void;
  returnToConversations: () => void;
  openPromptCenter: (assistantId?: string) => void;
  resetApplicationData: () => Promise<void>;
}

const ChatRouterContext = createContext<ChatRouterContextValue | null>(null);

export function ChatRouterProvider({
  children,
  unreadMessages = {},
  onCallCreated,
  onOpenConversation,
  onOpenGroup,
  onOpenGroupFilePreview,
  onOpenGroupSubScreen,
  onGroupCreated,
  onOpenCreateGroup,
  onOpenSubScreen,
  onOpenPromptCenter,
  onRouteBack,
  onReturnToConversation,
  onReturnToConversations,
  onResetApplicationData,
  onActiveChatContextChange,
  ...chatParams
}: ChatRouterProviderProps) {
  // 群聊列表状态必须先于 useChatScreen 声明：会话列表失效回调需要立刻能重读群聊。
  const [groupChats, setGroupChats] = useState<GroupChat[]>([]);
  const [currentGroup, setCurrentGroup] = useState<GroupChat | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile>(
  DEFAULT_USER_PROFILE as UserProfile
  );
  const [currentUserReady, setCurrentUserReady] = useState(false);
  const userProfileReadRevision = useRef(0);
  const [groupListReady, setGroupListReady] = useState(false);
  const groupLoadRevisionRef = useRef(0);

  const loadGroups = useCallback(async () => {
    const revision = ++groupLoadRevisionRef.current;
    const groups = await listGroupChats();
    while (true) {
      const arrival = getAssistantMessageArrivalSnapshot();
      const arrivedGroups = await Promise.all(groups.map((group) => withArrivedConversationPreview(group, group.id)));
      if (revision !== groupLoadRevisionRef.current) return arrivedGroups;
      // 到达进度变化只重算预览；不能直接丢弃本次刷新，让列表永久停在旧消息。
      if (arrival !== getAssistantMessageArrivalSnapshot()) continue;
      setGroupChats(arrivedGroups);
      setGroupListReady(true);
      return arrivedGroups;
    }
  }, []);

  useEffect(() => {
    if (!chatParams.dbReady || !chatParams.conversationListLoadEnabled) return;
    // 用户消息、编辑与删除同样改变预览，列表不能只依赖 AI 交付或某个返回按钮。
    return setChatEventBus({
      emit: async (event, payload) => {
        if (!['messagesUpdated', 'messagesPatched', 'messagesDeleted', 'messagesReloadRequested'].includes(event)
          || !groupChats.some((group) => group.id === payload.sessionId)) return;
        await loadGroups();
      },
    });
  }, [chatParams.dbReady, chatParams.conversationListLoadEnabled, groupChats, loadGroups]);

  const state = useChatScreen({
    ...chatParams,
    onConversationListInvalidated: () => {
      void loadGroups().catch((error) => {
        console.error('Failed to refresh group conversation list:', error);
      });
    },
  });
  const {
    aiList,
    aiListReady,
    beginChatEntryRequest,
    currentAI,
    currentSession,
    handleSelectAI,
    loadAIAssistants,
    preloadConversationTimelines,
  } = state;
  const conversationPreparationSnapshotRef = useRef<ConversationPreparationSnapshot>({
    currentAIId: currentAI?.id || null,
    currentSessionId: currentSession?.id || null,
    aiList,
    beginChatEntryRequest,
    loadAIAssistants,
    enterConversation: handleSelectAI,
  });
  conversationPreparationSnapshotRef.current = {
    currentAIId: currentAI?.id || null,
    currentSessionId: currentSession?.id || null,
    aiList,
    beginChatEntryRequest,
    loadAIAssistants,
    enterConversation: handleSelectAI,
  };
  const conversationPreparationControllerRef = useRef<
    ReturnType<typeof createConversationPreparationController> | null
  >(null);
  if (!conversationPreparationControllerRef.current) {
    conversationPreparationControllerRef.current = createConversationPreparationController({
      getSnapshot: () => conversationPreparationSnapshotRef.current,
      getCanonicalConversation: getCanonicalChatConversation,
    });
  }
  const conversationPreparationController = conversationPreparationControllerRef.current;

  const loadCurrentUser = useCallback(async () => {
    const revision = ++userProfileReadRevision.current;
    try {
      const profile = await getCurrentUserProfile();
      if (revision === userProfileReadRevision.current) setCurrentUser(profile);
      return profile;
    } catch (error) {
      console.error('Failed to load current user for chat shell:', error);

      const fallback = DEFAULT_USER_PROFILE as UserProfile;
      if (revision === userProfileReadRevision.current) setCurrentUser(fallback);
      return fallback;
    } finally {
      if (revision === userProfileReadRevision.current) setCurrentUserReady(true);
    }
  }, []);

  useEffect(() => {
    return subscribeUserProfileUpdated((profile) => {
      userProfileReadRevision.current++;
      setCurrentUser(profile);
      setCurrentUserReady(true);
    });
  }, []);

  useEffect(() => {
    if (
      !chatParams.dbReady ||
      !chatParams.conversationListLoadEnabled
    ) {
      return;
    }

    void loadGroups().catch((error) => {
      console.error('Failed to load group conversation list:', error);
      markConversationListFailed(error);
      });
    }, [
      chatParams.dbReady,
      chatParams.conversationListLoadEnabled,
      loadGroups,
  ]);

  useEffect(() => {
    if (
      !chatParams.dbReady
      || !chatParams.conversationListLoadEnabled
    ) {
      return;
    }

    void loadCurrentUser();
  }, [
    chatParams.dbReady,
    chatParams.conversationListLoadEnabled,
    loadCurrentUser,
  ]);

  /**
   * 预热热点集合是**动态**的：会话列表事实更新（新消息 / 置顶 / clear / 删除 /
   * 新建 canonical 会话）后都要重算。两条通道分开管理：
   *   - identity/order 变化（top 候选换人）→ 热点签名变化 → 正常开新一轮；
   *   - 同一 hot set 内某条会话的消息事实变化 → 只做定向失效 + 定向刷新。
   * 时间值不进入签名，否则任意一条消息都会让整批 16 条重跑。
   */
  const listReadySignalledRef = useRef(false);
  const preloadHotSetSignatureRef = useRef<string | null>(null);
  const preloadFreshnessSnapshotRef = useRef<ConversationPreloadFreshnessSnapshot | null>(null);
  // 前台群聊只影响「本轮读哪些」，不影响热点集合本身，因此走 ref 而不是 effect 依赖。
  const activeGroupIdRef = useRef<string | null>(null);
  activeGroupIdRef.current = currentGroup?.id ?? null;

  useEffect(() => {
    if (!aiListReady || !groupListReady) {
      return;
    }

    if (!listReadySignalledRef.current) {
      listReadySignalledRef.current = true;
      markConversationListReady();
    }

    const candidates = buildConversationPreloadCandidates({ aiList, groupChats });
    const decision = resolveConversationPreloadHotSet({
      previousSignature: preloadHotSetSignatureRef.current,
      candidates,
    });
    const freshness = resolveConversationPreloadFreshnessChanges({
      previous: preloadFreshnessSnapshotRef.current,
      candidates,
    });

    preloadHotSetSignatureRef.current = decision.signature;
    preloadFreshnessSnapshotRef.current = freshness.snapshot;

    // 明细事实变过的会话，其 timeline cache 无法证明仍然 fresh：显式判 invalid，
    // 让接下来的 preloadSessionTimeline 必须回 DB 读最新窗口。
    for (const candidate of freshness.changedCandidates) {
      clearSessionTimelineCache(candidate.sessionId);
    }

    // 签名变了就整轮预热；签名没变但有个别会话事实变了，则只刷新这些会话。
    const roundCandidates = decision.shouldPreload
      ? decision.candidates
      : freshness.changedCandidates;
    if (roundCandidates.length === 0) {
      return;
    }

    // 前台会话由 ChatDetail / GroupChatDetail 自己读 timeline，后台不重复占用调度。
    // 只过滤 runnable 读集合，签名与 freshness 都已按全量候选算完。
    const runnableCandidates = filterRunnableConversationPreloadCandidates(roundCandidates, {
      activeGroupId: activeGroupIdRef.current,
      isDirectConversationActiveOrPreparing: (aiId) => (
        conversationPreparationController.isConversationActiveOrPreparing(aiId)
      ),
    });
    void preloadConversationTimelines(runnableCandidates).catch((error) => {
      console.warn('Failed to preload recent conversations:', error);
    });
  }, [
    aiList,
    aiListReady,
    conversationPreparationController,
    groupChats,
    groupListReady,
    preloadConversationTimelines,
  ]);

  const openConversation = useCallback((ai: AIProfile) => {
    // 列表只表达打开意图；会话准备由目标路由持有，不让读库阻塞切页。
    onOpenConversation(ai.id);
  }, [onOpenConversation]);

  const ensureConversation = useCallback((aiId: string, sessionId?: string | null) => (
    conversationPreparationController.ensureConversation(aiId, sessionId)
  ), [conversationPreparationController]);

  const refreshConversations = useCallback(async () => {
    await Promise.all([
      state.loadAIAssistants(),
      loadGroups(),
      loadCurrentUser(),
    ]);
  }, [loadCurrentUser, loadGroups, state]);

  /**
   * 会话列表置顶只切换 pinned 事实，不参与任何消息事实。
   * 分区内顺序由统一排序函数计算，所以这里不需要（也不允许）自己排序。
   */
  const setConversationPinned = useCallback(async (
    target: { kind: ConversationKind; id: string },
    pinned: boolean,
  ) => {
    if (target.kind === 'group') {
      const updated = await updateGroupChatPinned(target.id, pinned);
      setCurrentGroup((current) => current?.id === updated.id ? updated : current);
      setGroupChats((current) => current.map((group) => (
        group.id === updated.id ? updated : group
      )));
      return;
    }

    await setDirectConversationPinned(target.id, pinned);
    await loadAIAssistants();
  }, [loadAIAssistants]);

  const openGroup = useCallback((group: GroupChat) => {
    setCurrentGroup(group);
    onOpenGroup(group.id);
  }, [onOpenGroup]);

  const openGroupFilePreview = useCallback((groupId: string, params: FilePreviewParams) => {
    state.openFilePreview(params);
    onOpenGroupFilePreview(groupId);
  }, [onOpenGroupFilePreview, state]);

  const openGroupSubScreen = useCallback((groupId: string, screen: GroupChatSubScreen) => {
    onOpenGroupSubScreen(groupId, screen);
  }, [onOpenGroupSubScreen]);

  const ensureGroup = useCallback(async (groupId: string) => {
    if (currentGroup?.id === groupId) {
      return true;
    }
    const groups = groupChats.length > 0 ? groupChats : await loadGroups();
    const group = groups.find((item) => item.id === groupId);
    setCurrentGroup(group || null);
    return Boolean(group);
  }, [currentGroup?.id, groupChats, loadGroups]);

  const groupCreated = useCallback((details: GroupChatDetails) => {
    setGroupChats((current) => [
      details.group,
      ...current.filter((group) => group.id !== details.group.id),
    ]);
    setCurrentGroup(details.group);
    onGroupCreated(details.group.id);
  }, [onGroupCreated]);

  const groupDeleted = useCallback((groupId: string) => {
    setCurrentGroup((current) => current?.id === groupId ? null : current);
    setGroupChats((current) => current.filter((group) => group.id !== groupId));
  }, []);

  const groupUpdated = useCallback((group: GroupChat) => {
    // 列表顺序由统一排序函数在展示层计算，state 里的数组顺序不代表展示顺序，
    // 因此这里只做事实替换，不再维护第二套排序。
    setCurrentGroup((current) => current?.id === group.id ? group : current);
    setGroupChats((current) => current.map((item) => item.id === group.id ? group : item));
  }, []);

  /** 群聊会话列表事实（preview / 顺序）重读；群聊详情返回列表时使用。 */
  const refreshGroupChats = useCallback(async () => {
    try {
      return await loadGroups();
    } catch (error) {
      console.error('Failed to refresh group conversation list:', error);
      throw error;
    }
  }, [loadGroups]);

  const openSubScreen = useCallback((screen: ChatSubScreen) => {
    const aiId = state.currentAI?.id;
    if (!aiId) {
      return;
    }
    state.setCurrentSubScreen(screen);
    onOpenSubScreen(aiId, screen);
  }, [onOpenSubScreen, state]);

  const value = useMemo<ChatRouterContextValue>(() => ({
    state,
    groupChats,
    currentGroup,
    currentUser,
    currentUserReady,
    unreadMessages,
    onCallCreated,
    onActiveChatContextChange,
    openConversation,
    ensureConversation,
    refreshConversations,
    setConversationPinned,
    refreshGroupChats,
    openGroup,
    openGroupFilePreview,
    openGroupSubScreen,
    ensureGroup,
    groupCreated,
    groupDeleted,
    groupUpdated,
    openCreateGroup: onOpenCreateGroup,
    openSubScreen,
    openPromptCenter: onOpenPromptCenter,
    resetApplicationData: onResetApplicationData,
    routeBack: onRouteBack,
    returnToConversation: onReturnToConversation,
    returnToConversations: onReturnToConversations,
  }), [
    currentGroup,
    currentUser,
    currentUserReady,
    ensureConversation,
    ensureGroup,
    groupChats,
    groupCreated,
    groupDeleted,
    groupUpdated,
    onCallCreated,
    onActiveChatContextChange,
    onOpenCreateGroup,
    onOpenPromptCenter,
    onResetApplicationData,
    onRouteBack,
    onReturnToConversation,
    onReturnToConversations,
    openConversation,
    openGroup,
    openGroupFilePreview,
    openGroupSubScreen,
    openSubScreen,
    refreshConversations,
    refreshGroupChats,
    setConversationPinned,
    state,
    unreadMessages,
  ]);

  return <ChatRouterContext.Provider value={value}>{children}</ChatRouterContext.Provider>;
}

export function useChatRouter(): ChatRouterContextValue {
  const context = useContext(ChatRouterContext);
  if (!context) {
    throw new Error('useChatRouter 必须在 ChatRouterProvider 内使用');
  }
  return context;
}
