/** 仅在玻璃主题中挂载；拖动只更新草稿，松手后统一应用并保存材质。 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GLASS_BLUR_RANGE, ThemedSurface, getThemeById, useThemeContext, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import { Slider } from '@shared/ui';

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  card: { marginHorizontal: theme.spacing.lg, padding: theme.spacing.lg, borderRadius: theme.radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  title: { flex: 1, fontSize: 16, color: theme.colors.text.primary },
  value: { fontSize: 16, color: theme.colors.brand.primary, fontVariant: ['tabular-nums'] },
  hint: { marginTop: theme.spacing.xs, marginBottom: theme.spacing.sm, fontSize: 13, color: theme.colors.text.secondary },
  limit: { fontSize: 12, color: theme.colors.text.secondary },
  reset: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' },
  resetText: { fontSize: 13, color: theme.colors.brand.primary },
});

export default function GlassBlurSettings() {
  const { theme, themeId, setGlassBlurRadius } = useThemeContext();
  const styles = useThemedStyles(createStyles);
  const radius = theme.effects.glass.blurRadius;
  const defaultRadius = getThemeById(themeId).effects.glass.blurRadius;
  const [draft, setDraft] = useState(radius);
  useEffect(() => { setDraft(radius); }, [radius]);
  const apply = (value: number) => {
    setDraft(value);
    void setGlassBlurRadius(value);
  };

  return (
    <ThemedSurface style={styles.card} variant="card">
      <View style={styles.row}>
        <Text style={styles.title}>玻璃模糊度</Text>
        <Text style={styles.value}>{draft}</Text>
      </View>
      <Text style={styles.hint}>数值越小越清透，松手后应用到全部玻璃组件。</Text>
      <Slider value={draft} {...GLASS_BLUR_RANGE} onValueChange={setDraft}
        onSlidingComplete={apply} accessibilityLabel="玻璃模糊度" />
      <View style={styles.row}>
        <Text style={styles.limit}>清透</Text><Text style={styles.limit}>磨砂</Text>
      </View>
      <TouchableOpacity style={styles.reset} onPress={() => apply(defaultRadius)}
        accessibilityRole="button" accessibilityLabel="恢复默认玻璃模糊度">
        <Text style={styles.resetText}>恢复默认</Text>
      </TouchableOpacity>
    </ThemedSurface>
  );
}
