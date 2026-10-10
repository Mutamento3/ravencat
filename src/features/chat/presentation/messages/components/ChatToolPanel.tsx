/** 展示聊天输入区的图片、相机、文件与通话工具入口。 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Camera, FileText, Headphones, Image, Video, type LucideIcon } from 'lucide-react-native';
import { useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import { resolveChatToolPanelTools } from './chatToolPanelCapability';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// 每行显示的数量
const ITEMS_PER_ROW = 4;
// 每个工具项的容器宽度
const ITEM_SIZE = (SCREEN_WIDTH - 32 - (ITEMS_PER_ROW - 1) * 16) / ITEMS_PER_ROW;
// 灰色垫底大小
const ICON_BG_SIZE = 56;

interface ToolItemDef {
  id: string;
  Icon: LucideIcon;
  label: string;
}

interface ChatToolPanelProps {
  height: number;
  onImagePress?: () => void;
  onCameraPress?: () => void;
  onFilePress?: () => void;
  onVideoCallPress?: () => void;
  /** 仅当前主理 AI 注入该回调；无回调时不展示 Together Listening 入口。 */
  onTogetherListeningPress?: () => void;
}

// 默认工具列表，可扩展
const DEFAULT_TOOLS: ToolItemDef[] = [
  { id: 'image', Icon: Image, label: '上传图片' },
  { id: 'camera', Icon: Camera, label: '拍照' },
  { id: 'file', Icon: FileText, label: '上传文件' },
  { id: 'videoCall', Icon: Video, label: '视频电话' },
];

const TOGETHER_LISTENING_TOOL: ToolItemDef = {
  id: 'togetherListening',
  Icon: Headphones,
  label: '一起听',
};

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.chat.inputBar,
      borderTopWidth: 0.5,
      borderTopColor: theme.colors.border.default,
    },
    scrollView: {
      flex: 1,
    },
    gridContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 16,
      paddingTop: 24,
      paddingBottom: 16,
      gap: 16,
    },
    toolItem: {
      width: ITEM_SIZE,
      alignItems: 'center',
    },
    iconBackground: {
      width: ICON_BG_SIZE,
      height: ICON_BG_SIZE,
      borderRadius: 12,
      backgroundColor: theme.colors.border.default,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 8,
    },
    toolLabel: {
      fontSize: 12,
      color: theme.colors.text.primary,
    },
  });

export default function ChatToolPanel({
  height,
  onImagePress,
  onCameraPress,
  onFilePress,
  onVideoCallPress,
  onTogetherListeningPress,
}: ChatToolPanelProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const tools = resolveChatToolPanelTools({
    defaultTools: DEFAULT_TOOLS,
    togetherListeningTool: TOGETHER_LISTENING_TOOL,
    togetherListeningHandler: onTogetherListeningPress,
  });

  const handlePress = (id: string) => {
    if (id === 'image') {
      onImagePress?.();
    } else if (id === 'camera') {
      onCameraPress?.();
    } else if (id === 'file') {
      onFilePress?.();
    } else if (id === 'videoCall') {
      onVideoCallPress?.();
    } else if (id === 'togetherListening') {
      onTogetherListeningPress?.();
    }
  };

  return (
    <View style={[styles.container, { height }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.gridContainer}
        showsVerticalScrollIndicator={false}
      >
        {tools.map((tool) => (
          <TouchableOpacity
            key={tool.id}
            style={styles.toolItem}
            onPress={() => handlePress(tool.id)}
            activeOpacity={0.7}
          >
            <View style={styles.iconBackground}>
              <tool.Icon size={26} strokeWidth={1.65} color={theme.colors.icon.primary} />
            </View>
            <Text style={styles.toolLabel}>{tool.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}
