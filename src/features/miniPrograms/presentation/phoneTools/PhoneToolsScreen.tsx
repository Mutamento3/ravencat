/** 手机工具小程序：Phone Tools 产品能力目录。 */

import { showAppDialog } from '@shared/ui';
import React from 'react';
import { StyleSheet, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { openUsageAccessSettings } from '@platform/device';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  PHONE_TOOL_CATALOG,
  PHONE_TOOL_CATEGORIES,
  PHONE_TOOL_PACKAGE_CATALOG,
} from '@features/phoneTools';
import type {
  PhoneToolCatalogItemId,
  PhoneToolPackageStatus,
} from '@features/phoneTools';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import NavigationHeader from '@shared/ui/NavigationHeader';
import { buildPhoneToolsDirectory } from './PhoneToolsDirectoryModel';

interface PhoneToolsScreenProps {
  onBack: () => void;
  onOpenToolPackage: (packageId: string) => void;
}

const PHONE_TOOL_SECTIONS = buildPhoneToolsDirectory(
  PHONE_TOOL_CATALOG,
  PHONE_TOOL_CATEGORIES,
);

const PHONE_TOOL_ICONS = {
  installedAppSearch: 'search-outline',
  foregroundApp: 'apps-outline',
  appUsage: 'time-outline',
  accessibilityScreenRead: 'reader-outline',
  ocrScreenRead: 'scan-outline',
  appLaunch: 'open-outline',
  softAppLock: 'lock-closed-outline',
  softAppLockRelease: 'lock-open-outline',
} as const satisfies Record<PhoneToolCatalogItemId, keyof typeof Ionicons.glyphMap>;

function isPackageAvailable(status: PhoneToolPackageStatus): boolean {
  return status === 'available';
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background.screen,
    },
    scrollContent: {
      paddingTop: theme.spacing.md,
      paddingBottom: 48,
    },
    categoryTitle: {
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.xs,
      marginHorizontal: theme.spacing.lg,
      color: theme.colors.text.secondary,
      fontSize: 12,
    },
    card: {
      borderRadius: theme.radius.lg,
      marginHorizontal: theme.spacing.lg,
      overflow: 'hidden',
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: theme.spacing.lg,
    },
    itemDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border.light,
    },
    plannedItem: {
      opacity: 0.72,
    },
    iconContainer: {
      width: 28,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    textContainer: {
      flex: 1,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    itemName: {
      flexShrink: 1,
      fontSize: 16,
      color: theme.colors.text.primary,
    },
    itemDescription: {
      fontSize: 12,
      color: theme.colors.text.secondary,
      marginTop: 2,
      lineHeight: 17,
    },
    status: {
      marginLeft: theme.spacing.sm,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surface.input,
    },
    statusText: {
      fontSize: 11,
    },
    statusAvailable: {
      color: theme.colors.feedback.success,
    },
    statusPlanned: {
      color: theme.colors.text.tertiary,
    },
    chevron: {
      marginLeft: theme.spacing.sm,
    },
  });

export default function PhoneToolsScreen({
  onBack,
  onOpenToolPackage,
}: PhoneToolsScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <NavigationHeader title="手机工具" onGoBack={onBack} help={{ sections: [
        { title: '能力目录', body: '主理 AI 当前可用与正在开发的手机能力。' },
      ] }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {PHONE_TOOL_SECTIONS.map((section) => (
          <View key={section.id}>
            <Text style={styles.categoryTitle}>{section.title}</Text>
            <ThemedSurface nativeGlass variant="card" style={styles.card}>
              {section.items.map((tool, index) => {
                const rowStyle = [
                  styles.item,
                  index < section.items.length - 1 && styles.itemDivider,
                  tool.implementationStatus === 'planned' && styles.plannedItem,
                ];
                const rowContent = (
                  <>
                    <View style={styles.iconContainer}>
                      <Ionicons
                        name={PHONE_TOOL_ICONS[tool.id]}
                        size={20}
                        color={
                          tool.implementationStatus === 'available'
                            ? theme.colors.brand.primary
                            : theme.colors.text.tertiary
                        }
                      />
                    </View>
                    <View style={styles.textContainer}>
                      <View style={styles.titleRow}>
                        <Text style={styles.itemName}>{tool.title}</Text>
                        <View style={styles.status}>
                          <Text
                            style={[
                              styles.statusText,
                              tool.implementationStatus === 'available'
                                ? styles.statusAvailable
                                : styles.statusPlanned,
                            ]}
                          >
                            {tool.implementationStatus === 'available' ? '可使用' : '开发中'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.itemDescription}>{tool.description}</Text>
                    </View>
                    {tool.destination !== null && (
                      <Ionicons
                        name="chevron-forward-outline"
                        size={16}
                        color={theme.colors.text.tertiary}
                        style={styles.chevron}
                      />
                    )}
                  </>
                );

                if (tool.destination === 'usageAccessSettings') return (
                  <TouchableOpacity key={tool.id} style={rowStyle} activeOpacity={0.7}
                    onPress={() => { void openUsageAccessSettings().catch((error: unknown) => {
                      showAppDialog({ title: '无法打开设置', message: error instanceof Error ? error.message : '无法打开使用情况访问设置' });
                    }); }} accessibilityRole="button" accessibilityHint="打开系统使用情况访问设置">
                    {rowContent}
                  </TouchableOpacity>
                );

                return (
                  <View key={tool.id} style={rowStyle}>
                    {rowContent}
                  </View>
                );
              })}
            </ThemedSurface>
          </View>
        ))}
        <View>
          <Text style={styles.categoryTitle}>应用工具包</Text>
          <ThemedSurface nativeGlass variant="card" style={styles.card}>
            {PHONE_TOOL_PACKAGE_CATALOG.map((toolPackage, index) => (
              <TouchableOpacity
                key={toolPackage.id}
                style={[
                  styles.item,
                  index < PHONE_TOOL_PACKAGE_CATALOG.length - 1 && styles.itemDivider,
                ]}
                activeOpacity={0.7}
                onPress={() => onOpenToolPackage(toolPackage.id)}
                accessibilityRole="button"
                accessibilityHint={`查看${toolPackage.title}详情`}
              >
                <View style={styles.iconContainer}>
                  <Ionicons
                    name="musical-notes-outline"
                    size={20}
                    color={theme.colors.text.tertiary}
                  />
                </View>
                <View style={styles.textContainer}>
                  <View style={styles.titleRow}>
                    <Text style={styles.itemName}>{toolPackage.title}</Text>
                    <View style={styles.status}>
                      <Text
                        style={[
                          styles.statusText,
                          isPackageAvailable(toolPackage.implementationStatus)
                            ? styles.statusAvailable
                            : styles.statusPlanned,
                        ]}
                      >
                        {isPackageAvailable(toolPackage.implementationStatus) ? '可使用' : '开发中'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.itemDescription}>{toolPackage.description}</Text>
                </View>
                <Ionicons
                  name="chevron-forward-outline"
                  size={16}
                  color={theme.colors.text.tertiary}
                  style={styles.chevron}
                />
              </TouchableOpacity>
            ))}
          </ThemedSurface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
