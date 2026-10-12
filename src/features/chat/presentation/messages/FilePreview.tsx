// 文件预览页面 - 全屏展示文件内容
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { readPersistentMediaAsText } from '@platform/device/DeviceMediaService';
import { isChatAttachmentFilePreviewable } from '../../messages/application/AttachmentParser';
import { useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import NavigationHeader from '@shared/ui/NavigationHeader';

interface FilePreviewProps {
  fileUri?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  onBack?: () => void;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background.app,
    },
    content: {
      flex: 1,
    },
    centerContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    loadingText: {
      marginTop: 12,
      fontSize: 14,
      color: theme.colors.text.secondary,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
    },
    fileContent: {
      fontSize: 14,
      lineHeight: 22,
      color: theme.colors.text.primary,
      fontFamily: 'monospace',
    },
    unsupportedTitle: {
      marginTop: 16,
      fontSize: 16,
      fontWeight: '500',
      color: theme.colors.text.secondary,
    },
    fileNameText: {
      marginTop: 8,
      fontSize: 14,
      color: theme.colors.text.tertiary,
    },
  });

export default function FilePreview({
  fileUri,
  fileName,
  onBack,
}: FilePreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const styles = useThemedStyles(createStyles);

  const isTextFile = isChatAttachmentFilePreviewable({
    fileName: fileName || '',
  });

  useEffect(() => {
    if (!fileUri) {
      setContent(null);
      setError(null);
      return;
    }

    async function loadContent() {
      if (!isTextFile) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const text = await readPersistentMediaAsText(fileUri);
        setContent(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : '无法读取文件内容');
      } finally {
        setLoading(false);
      }
    }

    void loadContent();
  }, [fileUri, isTextFile]);

  const renderContent = () => {
    if (!fileUri) {
      return (
        <View style={styles.centerContent}>
          <Ionicons name="document-outline" size={64} color={styles.fileNameText.color} />
          <Text style={styles.unsupportedTitle}>文件地址无效</Text>
          <Text style={styles.fileNameText}>无法找到该文件的位置信息</Text>
        </View>
      );
    }

    if (loading) {
      return (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={styles.loadingText.color} />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContent}>
          <Ionicons name="alert-circle-outline" size={64} color={styles.fileNameText.color} />
          <Text style={styles.unsupportedTitle}>无法读取文件</Text>
          <Text style={styles.fileNameText}>{error}</Text>
        </View>
      );
    }

    if (!isTextFile) {
      return (
        <View style={styles.centerContent}>
          <Ionicons name="document-outline" size={64} color={styles.fileNameText.color} />
          <Text style={styles.unsupportedTitle}>此文件类型暂不支持预览</Text>
          {fileName ? <Text style={styles.fileNameText}>{fileName}</Text> : null}
        </View>
      );
    }

    return (
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.fileContent}>{content || ''}</Text>
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <NavigationHeader
        title={fileName || '文件预览'}
        onGoBack={onBack}
      />
      <View style={styles.content}>
        {renderContent()}
      </View>
    </SafeAreaView>
  );
}
