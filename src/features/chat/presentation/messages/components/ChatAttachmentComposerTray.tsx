/** 展示待发送附件的缩略图、处理状态与移除操作。 */

import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { AttachmentDraftItem } from '@features/chat/messages/domain';
import { formatFileSize } from '@features/chat/messages/domain';
import { useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

interface ChatAttachmentComposerTrayProps {
  attachments: AttachmentDraftItem[];
  onRemove?: (id: string) => void;
}

function getStatusText(attachment: AttachmentDraftItem): string {
  switch (attachment.status) {
    case 'preparing':
      return '准备中…';
    case 'persisting':
      return '保存中…';
    case 'parsing':
      return '解析中…';
    case 'failed':
      return attachment.errorMessage || '处理失败';
    case 'ready':
    default:
      if (attachment.type === 'image') {
        return '图片已就绪';
      }
      if (attachment.parseStatus === 'success') {
        return '文件已解析';
      }
      if (attachment.parseStatus === 'skipped') {
        return '文件已就绪（暂不解析）';
      }
      if (attachment.parseStatus === 'failed') {
        return attachment.parseError || '文件解析失败，将按文件发送';
      }
      return '文件已就绪';
  }
}

export default function ChatAttachmentComposerTray({
  attachments,
  onRemove,
}: ChatAttachmentComposerTrayProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {attachments.length > 1 ? (
        <Text style={styles.selectionCount}>已选 {attachments.length} 张图片</Text>
      ) : null}
      <ScrollView horizontal={attachments.length > 1} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
        {attachments.map((attachment) => {
          const isImage = attachment.type === 'image';
          const previewUri = attachment.thumbnailUri || attachment.localUri || attachment.originalUri;
          return (
            <View key={attachment.id} style={[styles.card, attachments.length > 1 ? styles.multiCard : null]}>
              {isImage ? (
                <View style={styles.previewWrap}>
                  {previewUri ? (
                    <Image source={{ uri: previewUri }} style={styles.imagePreview} />
                  ) : (
                    <View style={[styles.imagePreview, styles.imagePlaceholder]}>
                      <Ionicons name="image-outline" size={20} color={theme.colors.icon.secondary} />
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.fileIconWrap}>
                  <Ionicons name="document-text-outline" size={24} color={theme.colors.icon.primary} />
                </View>
              )}

              <View style={styles.content}>
                <Text numberOfLines={1} style={styles.fileName}>
                  {attachment.fileName || (isImage ? '未命名图片' : '未命名文件')}
                </Text>
                <Text numberOfLines={2} style={[
                  styles.statusText,
                  attachment.status === 'failed' ? styles.statusTextError : null,
                ]}>
                  {getStatusText(attachment)}
                </Text>
                <Text numberOfLines={1} style={styles.metaText}>
                  {isImage
                    ? `${attachment.width && attachment.height ? `${attachment.width}×${attachment.height} · ` : ''}${formatFileSize(attachment.fileSize)}`
                    : `${formatFileSize(attachment.fileSize)}${attachment.previewText ? ` · ${attachment.previewText}` : ''}`}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => onRemove?.(attachment.id)}
                accessibilityRole="button"
                accessibilityLabel={`移除${attachment.fileName}`}
              >
                <Ionicons name="close-circle" size={22} color={theme.colors.icon.secondary} />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: theme.colors.chat.inputBar,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface.default,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: theme.colors.border.default,
    padding: 10,
  },
  cards: {
    gap: 8,
  },
  multiCard: {
    width: 280,
  },
  selectionCount: {
    fontSize: 12,
    color: theme.colors.text.secondary,
    marginBottom: 6,
  },
  previewWrap: {
    marginRight: 10,
  },
  imagePreview: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: theme.colors.surface.muted,
  },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: theme.colors.surface.muted,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  content: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: 2,
  },
  statusText: {
    fontSize: 12,
    color: theme.colors.text.secondary,
    marginBottom: 2,
  },
  statusTextError: {
    color: theme.colors.feedback.error,
  },
  metaText: {
    fontSize: 11,
    color: theme.colors.text.tertiary,
  },
  removeButton: {
    paddingLeft: 8,
    alignSelf: 'flex-start',
  },
});
