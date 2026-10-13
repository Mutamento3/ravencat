/** 在同一 Android 文字选区内呈现思维链，复用 Markdown 解析和行内样式。 */

import React from 'react';
import { Text } from 'react-native';
import {
  AstRenderer,
  renderRules,
  type ASTNode,
  type MarkdownStyles,
  type RenderRules,
} from 'react-native-markdown-renderer';

type TextStyle = React.ComponentProps<typeof Text>['style'];

const textChildren: RenderRules[string] = (node, children) => (
  <Text key={node.key}>{children}</Text>
);
const listChildren: RenderRules[string] = (node, children, parents) => (
  <Text key={node.key}>{parents[0]?.type === 'list_item' ? '\n' : ''}{children}</Text>
);
const headingRules = Object.fromEntries(
  Array.from({ length: 6 }, (_, index) => [`heading${index + 1}`, (node: ASTNode, children: React.ReactNode[], _parents: ASTNode[], styles: MarkdownStyles) => (
    <Text key={node.key} style={styles[node.type] as TextStyle}>{children}</Text>
  )])
);

// 块级 View 会产生独立原生文字容器；此处只用嵌套 Text 和换行表达块边界。
// 行内格式、链接及代码继续使用库的规则，表格以文字分栏加入同一选区。
const continuousTextRules: RenderRules = {
  ...renderRules,
  ...headingRules,
  textgroup: textChildren,
  paragraph: (node, children, parents) => <Text key={node.key}>{parents.length > 0 && node.index > 0 ? '\n\n' : ''}{children}</Text>,
  bullet_list: listChildren,
  ordered_list: listChildren,
  list_item: (node, children, parents) => {
    const list = parents[0];
    const indent = '  '.repeat(parents.filter((parent) => parent.type === 'bullet_list' || parent.type === 'ordered_list').length - 1);
    const marker = list.type === 'ordered_list' ? `${Number(list.attributes.start ?? 1) + node.index}${node.markup} ` : '• ';
    return <Text key={node.key}>{node.index > 0 ? '\n' : ''}{indent}{marker}{children}</Text>;
  },
  blockquote: (node, children, _parents, styles) => (
    <Text key={node.key} style={styles.blockquote as TextStyle}>{'› '}{children}</Text>
  ),
  pre: textChildren,
  table: textChildren,
  thead: textChildren,
  tbody: (node, children) => <Text key={node.key}>{'\n'}{children}</Text>,
  tr: (node, children) => <Text key={node.key}>{node.index > 0 ? '\n' : ''}{children}</Text>,
  th: (node, children) => <Text key={node.key} style={{ fontWeight: '600' }}>{node.index > 0 ? ' | ' : ''}{children}</Text>,
  td: (node, children) => <Text key={node.key}>{node.index > 0 ? ' | ' : ''}{children}</Text>,
  hardbreak: (node) => <Text key={node.key}>{'\n'}</Text>,
  hr: (node) => <Text key={node.key}>────────</Text>,
  html_block: (node) => <Text key={node.key}>{node.content}</Text>,
  image: (node, children) => <Text key={node.key}>{children}{` (${node.attributes.src})`}</Text>,
  blocklink: renderRules.link,
  unknown: (node) => <Text key={node.key}>{node.type}</Text>,
};

export function createSelectableMarkdownRenderer(styles: MarkdownStyles) {
  const renderer = new AstRenderer(continuousTextRules, styles);
  return function renderSelectableMarkdown(nodes: ASTNode[]) {
    return (
      <Text selectable style={styles.text as TextStyle}>
        {nodes.map((node, index) => (
          <React.Fragment key={node.key}>
            {index > 0 ? '\n\n' : ''}
            {renderer.renderNode(node, [])}
          </React.Fragment>
        ))}
      </Text>
    );
  };
}
