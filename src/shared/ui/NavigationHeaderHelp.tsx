/** 顶部栏说明的锚定气泡；原生 Modal 承接浮层触摸，不占用页面布局。 */
import React, { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleHelp } from 'lucide-react-native';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

interface HelpSection { title: string; body: string }
interface HelpAnchor { x: number; y: number }
interface PopoverLayout { left: number; top: number; width: number; arrowLeft: number; maxHeight: number }

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  button: { width: 28, minHeight: 38, alignItems: 'center', justifyContent: 'center' },
  indicator: {
    width: 24, height: 24, borderRadius: theme.radius.round,
    alignItems: 'center', justifyContent: 'center',
  },
  overlay: { flex: 1 },
  popover: { position: 'absolute' },
  arrow: {
    position: 'absolute', top: 0, width: 0, height: 0,
    borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderBottomColor: theme.effects.glass.enabled ? theme.effects.glass.borderColor : theme.colors.surface.raised,
    zIndex: 1,
  },
  panel: {
    marginTop: 7,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surface.raised,
    ...theme.shadow.md,
  },
  label: { fontSize: 12, fontWeight: '500', color: theme.colors.text.secondary, marginBottom: theme.spacing.md },
  scroll: { flexShrink: 1 },
  content: { gap: theme.spacing.lg },
  section: { gap: 4 },
  sectionTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: theme.colors.text.primary },
  body: { fontSize: 13, lineHeight: 21, color: theme.colors.text.primary, opacity: 0.78 },
});

function HelpPopover({ anchor, sections, onClose }: {
  anchor: HelpAnchor; sections: readonly HelpSection[]; onClose(): void;
}) {
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const overlayRef = useRef<View>(null);
  const [layout, setLayout] = useState<PopoverLayout | null>(null);

  return <Modal transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={onClose}>
    <View ref={overlayRef} collapsable={false} style={styles.overlay} onLayout={(event) => {
      const { width: overlayWidth, height: overlayHeight } = event.nativeEvent.layout;
      // 主窗口和 Modal 可有不同的系统栏原点；两者都测量后再换算，不猜测状态栏偏移。
      overlayRef.current!.measureInWindow((originX, originY) => {
        const width = Math.min(320, overlayWidth - insets.left - insets.right - 32);
        const anchorX = anchor.x - originX;
        const top = anchor.y - originY + 20;
        const left = Math.max(insets.left + 16, Math.min(anchorX - width / 2, overlayWidth - insets.right - width - 16));
        setLayout({
          left, top, width,
          arrowLeft: Math.max(24, Math.min(anchorX - left, width - 24)) - 8,
          maxHeight: Math.min(380, overlayHeight - insets.bottom - top - 23),
        });
      });
    }}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="关闭使用说明" onPress={onClose} />
      {layout && <View style={[styles.popover, { left: layout.left, top: layout.top, width: layout.width }]}>
        <View pointerEvents="none" style={[styles.arrow, { left: layout.arrowLeft }]} />
        <ThemedSurface variant="modal" cornerRadius={styles.panel.borderRadius} backgroundColor={styles.panel.backgroundColor} style={[styles.panel, { maxHeight: layout.maxHeight }]}>
          <Text style={styles.label}>使用说明</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {sections.map((section) => <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.body}>{section.body}</Text>
            </View>)}
          </ScrollView>
        </ThemedSurface>
      </View>}
    </View>
  </Modal>;
}

export default function NavigationHeaderHelp({ title, sections }: { title: string; sections: readonly HelpSection[] }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const buttonRef = useRef<View>(null);
  const measurementRevision = useRef(0);
  const [anchor, setAnchor] = useState<HelpAnchor | null>(null);
  const close = useCallback(() => {
    // 离开页面或布局改变后，迟到的原生测量不能重新打开气泡。
    measurementRevision.current += 1;
    setAnchor(null);
  }, []);
  useFocusEffect(useCallback(() => close, [close]));

  return <>
    <Pressable
      ref={buttonRef} collapsable={false} style={styles.button}
      accessibilityRole="button" accessibilityLabel={`${title}使用说明`}
      accessibilityState={{ expanded: anchor !== null }} hitSlop={8}
      onLayout={close}
      onPress={() => {
        const revision = ++measurementRevision.current;
        buttonRef.current!.measureInWindow((x, y, width, height) => {
          if (revision === measurementRevision.current) setAnchor({ x: x + width / 2, y: y + height });
        });
      }}
    >
      <View style={styles.indicator}>
        <CircleHelp size={16} strokeWidth={1.75} color={theme.colors.brand.primary} />
      </View>
    </Pressable>
    {anchor !== null && <HelpPopover anchor={anchor} sections={sections} onClose={close} />}
  </>;
}
