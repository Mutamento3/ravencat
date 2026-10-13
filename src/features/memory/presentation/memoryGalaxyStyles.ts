import { StyleSheet } from 'react-native';
import { getThemeById, type PresentationTheme } from '@shared/theme';

export const createMemoryGalaxyStyles = (theme: PresentationTheme) => {
  const starlight = theme.mode === 'dark' ? theme.colors.text.primary : theme.colors.text.inverse;
  return StyleSheet.create({
    // 星空需要不透明底色，不能让宿主壁纸透过遮罩形成灰底。
    screen: { flex: 1, backgroundColor: getThemeById('default-dark').colors.background.app },
    fill: { ...StyleSheet.absoluteFillObject },
    sky: { flex: 1, overflow: 'hidden' },
    galaxyControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 12, paddingVertical: 16 },
    galaxyHint: { color: starlight, opacity: 0.45, fontSize: 11, textAlign: 'center' },
    spacePlanet: { position: 'absolute' },
    spaceButton: { alignItems: 'center' },
    pressedPlanet: { opacity: 0.7 },
    planetBody: { position: 'relative' },
    planetName: { marginTop: 0, fontSize: 11, fontWeight: '400', letterSpacing: 0.8, color: starlight, opacity: 0.85, textAlign: 'center', maxWidth: 124 },
    primaryPlanetName: { fontSize: 12, letterSpacing: 1.2, opacity: 0.92, maxWidth: 172 },
    planetMeta: { marginTop: 4, fontSize: 10, color: starlight, opacity: 0.5, textAlign: 'center' },
    navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: theme.effects.overlay.dim },
    title: { fontSize: 17, letterSpacing: 4, color: starlight, fontWeight: '500' },
    header: { paddingTop: 12, paddingHorizontal: 24, alignItems: 'center', gap: 8 },
    eyebrow: { color: starlight, opacity: 0.65, fontSize: 10, letterSpacing: 5 },
    subtitle: { color: starlight, opacity: 0.8, fontSize: 12, letterSpacing: 1 },
    empty: { color: starlight, lineHeight: 24, textAlign: 'center', padding: 32 },
    disabled: { opacity: 0.3 },
    // 窗口、材质和键盘避让由通用弹窗拥有；这里只保留记忆面板的内容尺寸。
    sheet: { height: '74%', paddingTop: 12 },
    handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: theme.colors.border.strong, marginBottom: 12 },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, gap: 12, marginBottom: 16 },
    sheetName: { color: theme.colors.text.primary, fontSize: 19, fontWeight: '600' },
    sheetMeta: { color: theme.colors.text.secondary, fontSize: 12, marginTop: 4 },
    sheetButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    tabs: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, paddingBottom: 14 },
    tab: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
    selectedTab: { backgroundColor: theme.colors.surface.muted },
    tabText: { color: theme.colors.text.secondary, fontSize: 14 },
    activeTabText: { color: theme.colors.brand.primary, fontSize: 14, fontWeight: '600' },
    list: { padding: 20, gap: 12, paddingBottom: 40 },
    search: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginBottom: 6, paddingHorizontal: 14, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface.input },
    input: { flex: 1, paddingVertical: 14, color: theme.colors.text.primary, fontSize: 14 },
    groupInput: { padding: 14, color: theme.colors.text.primary, fontSize: 14, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface.input },
    card: { padding: 18, gap: 14, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light },
    body: { fontSize: 15, lineHeight: 24, color: theme.colors.text.primary },
    meta: { color: theme.colors.text.secondary, fontSize: 12, lineHeight: 18 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    description: { color: theme.colors.text.secondary, fontSize: 13, lineHeight: 21, paddingHorizontal: 20, marginBottom: 12 },
    error: { color: theme.colors.feedback.error, padding: 20, textAlign: 'center' },
  });
};
