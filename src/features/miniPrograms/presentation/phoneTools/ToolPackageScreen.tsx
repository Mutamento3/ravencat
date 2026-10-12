/** 通用 Phone Tool Package 详情页，调用权限与提示词中心同步。 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getPhoneToolPackageById } from '@features/phoneTools';
import { ThemedSurface, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import NavigationHeader from '@shared/ui/NavigationHeader';
import { buildToolPackageDisplayModel } from './ToolPackageDisplayModel';
import { usePhoneToolSettings } from './usePhoneToolSettings';
import { Toggle } from '@shared/ui';

interface ToolPackageScreenProps {
  packageId?: string;
  onBack: () => void;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background.screen,
    },
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: 48,
    },
    description: {
      color: theme.colors.text.secondary,
      fontSize: 14,
      lineHeight: 21,
    },
    sectionTitle: {
      marginTop: theme.spacing.xl,
      marginBottom: theme.spacing.xs,
      color: theme.colors.text.secondary,
      fontSize: 12,
    },
    card: {
      borderRadius: theme.radius.lg,
      overflow: 'hidden',
    },
    toolRow: {
      paddingVertical: 14,
      paddingHorizontal: theme.spacing.lg,
    },
    toolDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border.light,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    toolTitle: {
      flex: 1,
      color: theme.colors.text.primary,
      fontSize: 16,
    },
    status: {
      marginLeft: theme.spacing.sm,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surface.input,
    },
    statusText: {
      color: theme.colors.text.tertiary,
      fontSize: 11,
    },
    statusAvailable: {
      color: theme.colors.feedback.success,
    },
    toolDescription: {
      marginTop: 3,
      color: theme.colors.text.secondary,
      fontSize: 12,
      lineHeight: 17,
    },
    emptyTitle: {
      color: theme.colors.text.primary,
      fontSize: 15,
    },
    emptyDescription: {
      marginTop: theme.spacing.xs,
      color: theme.colors.text.secondary,
      fontSize: 13,
      lineHeight: 19,
    },
  });

export default function ToolPackageScreen({ packageId, onBack }: ToolPackageScreenProps) {
  const styles = useThemedStyles(createStyles);
  const settings = usePhoneToolSettings();
  const toolPackage = packageId ? getPhoneToolPackageById(packageId) : undefined;

  if (!toolPackage) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <NavigationHeader title="工具包不存在" onGoBack={onBack} />
        <View style={styles.content}>
          <Text style={styles.description}>这个工具包不存在或已经下架。</Text>
        </View>
      </SafeAreaView>
    );
  }

  const displayModel = buildToolPackageDisplayModel(toolPackage);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <NavigationHeader title={displayModel.title} onGoBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.description}>{displayModel.description}</Text>
        <Text style={styles.toolDescription}>{settings.description}</Text>
        <Text style={styles.sectionTitle}>工具</Text>
        <ThemedSurface nativeGlass variant="card" style={styles.card}>
          {displayModel.tools.length === 0 ? (
            <View style={styles.toolRow}>
              <Text style={styles.emptyTitle}>当前暂无可用工具</Text>
              <Text style={styles.emptyDescription}>
                后续版本会逐步接入此工具包的专属能力。
              </Text>
            </View>
          ) : (
            displayModel.tools.map((tool, index) => (
              <View
                key={tool.id}
                style={[
                  styles.toolRow,
                  index < displayModel.tools.length - 1 && styles.toolDivider,
                ]}
              >
                <View style={styles.titleRow}>
                  <Text style={styles.toolTitle}>{tool.title}</Text>
                  <View style={styles.status}>
                    <Text
                      style={[
                        styles.statusText,
                        tool.implementationStatus === 'available' && settings.statusLabel(tool.toolName) === '权限就绪' && styles.statusAvailable,
                      ]}
                    >
                      {tool.implementationStatus === 'available' ? settings.statusLabel(tool.toolName) : tool.statusLabel}
                    </Text>
                  </View>
                  {tool.implementationStatus === 'available' && <Toggle
                    accessibilityLabel={`允许调用${tool.title}`}
                    disabled={settings.disabled}
                    value={settings.isEnabled(tool.toolName)}
                    onValueChange={(enabled) => { void settings.toggleTool(tool.toolName, enabled); }}
                  />}
                </View>
                <Text style={styles.toolDescription}>{tool.description}</Text>
              </View>
            ))
          )}
        </ThemedSurface>
      </ScrollView>
    </SafeAreaView>
  );
}
