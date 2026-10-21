/** 只展示调用元数据，不保存或展示完整请求与模型思考正文。 */
import React from 'react';
import { Text, View } from 'react-native';
import { ThemedSurface, useThemedStyles } from '@shared/theme';
import { CHAT_SUMMARY_MAX_AUTOMATIC_ATTEMPTS, type ChatSummaryTask } from '../domain/ChatSummaryRepository';
import { createChatSummaryStyles } from './chatSummaryStyles';

export default function ChatSummaryDiagnostics({ task }: { task: ChatSummaryTask }) {
  const styles = useThemedStyles(createChatSummaryStyles);
  const number = (value: number | null) => value === null ? '服务端未提供' : String(value);
  return <ThemedSurface variant="card" nativeGlass={false} style={styles.card}>
    <Text style={styles.body}>调用信息 · 任务尝试 {task.attemptCount} 次</Text>
    <Text style={styles.meta}>最多自动重试 {CHAT_SUMMARY_MAX_AUTOMATIC_ATTEMPTS - 1} 次。尝试次数包含手动重试和取消后恢复；一次任务只调用一次模型。</Text>
    {task.error && <>
      <Text accessibilityRole={task.status === 'completed' ? undefined : 'alert'} style={task.status === 'completed' ? styles.meta : styles.danger}>
        {task.status === 'completed' ? '最近一次失败（已恢复）：' : ''}{task.error.message}
      </Text>
      <Text style={styles.meta}>错误类型：{task.error.kind} · {new Date(task.error.occurredAt).toLocaleString()}</Text>
    </>}
    {task.nextAttemptAt && <Text style={styles.meta}>下次自动重试：{new Date(task.nextAttemptAt).toLocaleString()}</Text>}
    {task.calls.map((call, index) => <View key={index} style={styles.details}>
      <Text style={styles.action}>调用 {index + 1} · {call.model}</Text>
      <Text style={styles.meta}>耗时 {(call.durationMs / 1000).toFixed(1)} 秒 · 最长等待 {call.timeoutSeconds} 秒</Text>
      <Text style={styles.meta}>请求输出上限：{call.requestedMaxTokens === null ? '未指定，使用服务端默认值' : `${call.requestedMaxTokens} token`}</Text>
      <Text style={styles.meta}>输入 token：{number(call.promptTokens)} · 输出 token：{number(call.completionTokens)}</Text>
      <Text style={styles.meta}>总 token：{number(call.totalTokens)} · 缓存 token：{number(call.cachedTokens)}</Text>
      <Text style={styles.meta}>结束原因：{call.finishReason ?? '服务端未提供'} · 正文 {call.contentCharacters} 字 · 思考 {call.reasoningCharacters} 字</Text>
      <Text style={styles.meta}>HTTP 状态：{call.httpStatus ?? '未提供'}</Text>
      {call.serverError && <Text style={styles.danger}>服务端／请求错误：{call.serverError}</Text>}
    </View>)}
    {task.calls.length === 0 && <Text style={styles.meta}>尚无调用用量记录。</Text>}
  </ThemedSurface>;
}
