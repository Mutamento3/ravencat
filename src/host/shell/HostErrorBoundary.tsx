/** 捕获宿主渲染边界内的未处理异常，避免应用只留下空白页面。 */
import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface HostErrorBoundaryProps {
  children: ReactNode;
}

interface HostErrorBoundaryState {
  error: Error | null;
}

export default class HostErrorBoundary extends Component<
  HostErrorBoundaryProps,
  HostErrorBoundaryState
> {
  state: HostErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): HostErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Host] 未处理的渲染异常', error, info.componentStack);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <View style={styles.container}>
        <Text style={styles.title}>页面暂时无法显示</Text>
        <Text style={styles.message}>应用遇到了意外错误，请重试。</Text>
        <Pressable
          accessibilityRole="button"
          onPress={this.retry}
          style={styles.button}
        >
          <Text style={styles.buttonText}>重试</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    backgroundColor: '#111111',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
  },
  message: {
    color: '#C8C8C8',
    fontSize: 15,
    textAlign: 'center',
  },
  button: {
    marginTop: 8,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  buttonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
});
