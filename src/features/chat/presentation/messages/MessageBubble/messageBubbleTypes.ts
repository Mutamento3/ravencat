/** 定义消息气泡中工具过程卡片的展示状态契约。 */

export interface MessageProcessCardState {
  kind: 'tool';
  title: string;
  status: 'running' | 'completed' | 'failed';
}
