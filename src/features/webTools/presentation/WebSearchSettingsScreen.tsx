import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Globe } from 'lucide-react-native';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import { InputField, KeyboardAvoidingContainer, Toggle, showAppDialog } from '@shared/ui';
import NavigationHeader from '@shared/ui/NavigationHeader';
import type { WebSearchEngine } from '@platform/web';
import { SEARCH_SOURCES } from '../domain/SearchSettings';
import { readSearchConfiguration, updateSearchConfiguration, testAndSaveSearchKey } from '../application/SearchConfiguration';
import { createSearchSettingsStyles } from './searchSettingsStyles';

type Configuration = Awaited<ReturnType<typeof readSearchConfiguration>>;

/** 页面只管理配置；工具对各 AI 的调用授权继续由现有权限系统拥有。 */
export default function WebSearchSettingsScreen({ onBack, refreshRevision = 0 }: { onBack: () => void; refreshRevision?: number }) {
  const theme = useTheme();
  const styles = useThemedStyles(createSearchSettingsStyles);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [keys, setKeys] = useState({ tavily: '', brave: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  const draftsLoaded = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    controller.current = new AbortController();
    return () => { mounted.current = false; controller.current!.abort(); };
  }, []);
  useEffect(() => {
    let active = true;
    void readSearchConfiguration().then(value => { if (active) {
      setConfiguration(value); setError(null);
      if (!draftsLoaded.current) {
        setKeys({ tavily: value.sources.find(source => source.engine === 'tavily')!.apiKey,
          brave: value.sources.find(source => source.engine === 'brave')!.apiKey });
        draftsLoaded.current = true;
      }
    } },
      () => { if (active) setError('无法读取搜索配置，请返回后重试'); });
    return () => { active = false; };
  }, [refreshRevision]);

  async function perform(action: () => Promise<unknown>, message = '') {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setStatus('');
    try {
      await action();
      if (!mounted.current) return;
      const next = await readSearchConfiguration();
      if (mounted.current) { setConfiguration(next); setError(null); setStatus(message); }
    } catch (failure) {
      if (mounted.current) showAppDialog({ title: '操作未完成', message: failure instanceof Error ? failure.message : '搜索配置操作失败', tone: 'error' });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function action(label: string, onPress: () => void, disabled = false) {
    return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={busy || disabled}
      onPress={onPress} style={(busy || disabled) && styles.muted}>
      <Text style={styles.action}>{label}</Text>
    </TouchableOpacity>;
  }

  function sourceCard(engine: WebSearchEngine, name: string, needsKey: boolean) {
    const source = configuration!.sources.find(item => item.engine === engine)!;
    const selected = configuration!.defaultEngine === engine;
    const apiEngine = engine === 'tavily' || engine === 'brave' ? engine : null;
    return <ThemedSurface key={engine} variant="card" style={styles.card}><View style={styles.body}>
      <View style={styles.row}><View style={styles.copy}>
        <Text style={styles.title}>{name}{selected ? ' · 默认' : ''}</Text>
        <Text style={styles.hint}>{needsKey ? '使用你自己的 API Key' : '内置来源 · 无需密钥'}</Text>
      </View><Toggle accessibilityLabel={`允许 AI 使用 ${name}`} value={source.enabled} disabled={busy || !source.configured}
        onValueChange={enabled => { void perform(() => updateSearchConfiguration({ kind: 'enabled', engine, enabled })); }} /></View>
      {apiEngine && <>
        <InputField label={`${name} API Key`} value={keys[apiEngine]} autoGrow editable={!busy} autoCapitalize="none" autoCorrect={false} maxLength={512}
          placeholder="填写 API Key"
          onChangeText={value => setKeys(previous => ({ ...previous, [apiEngine]: value }))} />
        <View style={styles.actions}>
          {action(keys[apiEngine].trim() !== source.apiKey ? '测试并保存' : '测试连接', () => {
            void perform(() => testAndSaveSearchKey(apiEngine, keys[apiEngine], controller.current!.signal), `${name} 连接正常`);
          }, !keys[apiEngine].trim())}
        </View>
      </>}
      {engine === 'tavily' && <View style={styles.row}>
        <View style={styles.copy}><Text style={styles.title}>允许深度搜索</Text>
          <Text style={styles.hint}>比基础搜索消耗更多额度</Text></View>
        <Toggle accessibilityLabel="允许 Tavily 深度搜索" value={configuration!.allowAdvanced} disabled={busy}
          onValueChange={allowed => { void perform(() => updateSearchConfiguration({ kind: 'advanced', allowed })); }} />
      </View>}
      {!selected && action(`将 ${name} 设为默认`, () => { void perform(() => updateSearchConfiguration({ kind: 'default', engine })); }, !source.enabled || !source.configured)}
    </View></ThemedSurface>;
  }

  const defaultName = SEARCH_SOURCES.find(source => source.engine === configuration?.defaultEngine)?.name ?? '未选择';
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <NavigationHeader title="联网搜索" onGoBack={onBack} help={{ sections: [
      { title: '默认来源', body: 'AI 优先使用默认来源，按需切换到其他已启用来源。首次成功配置自有服务后会自动设为默认，之后添加服务保留已有选择。禁用默认来源后，需要重新选择。' },
      { title: '密钥与连接测试', body: 'Tavily 和 Brave 使用你自己的 API Key，密钥保存在本机安全存储中。测试会使用输入框中的密钥发起一次基础搜索，并使用该服务的额度。' },
      { title: 'Tavily 深度搜索', body: '允许后，AI 可以按需使用深度搜索，它比基础搜索消耗更多额度。默认关闭。' },
      { title: 'DuckDuckGo 与网络代理', body: 'DuckDuckGo 在中国大陆网络下通常无法直连。本工具不采用系统 HTTP/SOCKS 代理；使用 VPN 模式时，需要让它接管本应用的流量。即使网络可达，上游仍可能要求验证码或限流。' },
      { title: '网络与调用权限', body: '内置搜索依赖上游和手机网络，可能遇到验证码或限流。搜索查询会发送给所选提供方，费用与额度由该账号承担。各 AI 的工具调用权限沿用提示词中心的现有设置。' },
    ] }} />
    <KeyboardAvoidingContainer style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.row}><Globe color={theme.colors.brand.primary} size={26} /><View style={styles.copy}>
          <Text style={styles.title}>默认来源：{defaultName}</Text>
        </View></View>
        {error && <Text accessibilityRole="alert" style={[styles.hint, styles.danger]}>{error}</Text>}
        {busy && <ActivityIndicator color={theme.colors.brand.primary} />}
        {status ? <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text> : null}
        {!configuration && !error && <ActivityIndicator color={theme.colors.brand.primary} />}
        {configuration && <>
          {SEARCH_SOURCES.map(source => sourceCard(source.engine, source.name, source.needsKey))}
        </>}
      </ScrollView>
    </KeyboardAvoidingContainer>
  </SafeAreaView>;
}
