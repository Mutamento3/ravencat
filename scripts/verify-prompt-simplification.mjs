import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

async function importTypeScript(relativePath) {
  const source = read(relativePath);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
    fileName: relativePath,
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(errors, [], `无法编译 ${relativePath}`);
  const encoded = Buffer.from(compiled.outputText, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

async function verifyLocale() {
  // 单语化契约只断言「值」：内置正文都是单个中文字符串（不是 locale map）。
  // 不再用源码切片去找 `].join('\n');`——那会把实现写法（数组拼接）也一起钉死，
  // 属于 AGENTS §12.1 禁止的源码形状断言：正文换个等价写法不该让门禁变红。
  const builtIn = await importTypeScript('src/host/prompt/PromptBuiltInContent.ts');
  for (const id of [
    'DEFAULT_CORE_SYSTEM_PROMPTS',
    'DEFAULT_IMAGE_GROUNDING_PROMPT',
    'DEFAULT_PARAGRAPH_BREAKS_PROMPT',
    'GROUP_MEMBER_REPLY_CONFIDENTIALITY_RULES',
  ]) {
    const value = builtIn[id];
    assert.equal(typeof value, 'string', `${id} 必须是单份正文，不得再按 locale 分组`);
    assert.match(value, /[\u4e00-\u9fff]/u, `${id} 必须是中文正文`);
    assert.doesNotMatch(
      value,
      /'zh-CN'|'en-US'|\[WHERE YOU RUN\]/u,
      `${id} 不得再按 locale 分组或残留英文镜像正文`,
    );
  }
  console.log('Prompt locale 检查通过（内置 Prompt 固定中文，不维护英文镜像正文）。');
}

async function verifyChatEnvelope() {
  const segmentation = await importTypeScript(
    'src/features/chat/reply/application/AssistantReplySegmentation.ts'
  );

  assert.deepEqual(
    segmentation.segmentAssistantReplyText('   ', 'multi-bubble'),
    [],
    '空白回复不得产生任何分段'
  );
  assert.deepEqual(
    segmentation.segmentAssistantReplyText('  单气泡回复  ', 'single-bubble'),
    ['单气泡回复'],
    'single-bubble 必须 trim 后整段投递'
  );
  assert.deepEqual(
    segmentation.segmentAssistantReplyText(
      '你好！\n\n很高兴见到你！\n\n你今天怎么样？',
      'multi-bubble'
    ),
    ['你好！', '很高兴见到你！', '你今天怎么样？'],
    'multi-bubble 必须按空行切分为独立气泡片段'
  );
  const longParagraph = Array.from({ length: 20 }, (_, index) => `这是第${index + 1}句足够长的话。`).join('');
  const sentenceSegments = segmentation.segmentAssistantReplyText(longParagraph, 'multi-bubble');
  assert.ok(sentenceSegments.length > 1, '超过 100 字符的单段必须按句末标点二次切分');
  assert.ok(
    sentenceSegments.slice(0, -1).every((segment) => segment.length >= 100 && /[。！？!?；;…]["'”’）)]*$/.test(segment)),
    '长段达到阈值后在完整句末闭合，不回头挪动已经显示的句子'
  );
  assert.equal(sentenceSegments.join(''), longParagraph, '二次切分不得丢失正文');
  const noPunctuation = '无标点长句'.repeat(100);
  assert.deepEqual(
    segmentation.segmentAssistantReplyText(noPunctuation, 'multi-bubble'),
    [noPunctuation],
    '无句末标点可切的超长段必须整段保留，不得按阈值硬切成半句话'
  );
  for (const text of [
    '  第一泡\n\n第二泡\n \n第三泡  ',
    '长'.repeat(99) + '！？”)下一句。\n\n再说一句。',
    '短句。'.repeat(60) + '没有句末的尾巴',
    noPunctuation,
  ]) {
    let previous = [];
    for (let end = 1; end <= text.length; end++) {
      const segments = segmentation.segmentAssistantReplyProgress(text.slice(0, end), 'multi-bubble', false);
      for (const [index, segment] of previous.entries()) {
        assert.ok(segments[index].text.startsWith(segment.text), '任意 delta 边界下已显示文字不能缩短或搬家');
        if (segment.completed) assert.deepEqual(segments[index], segment, '闭合气泡后续不能再改写');
      }
      previous = segments;
    }
    const final = segmentation.segmentAssistantReplyProgress(text, 'multi-bubble', true);
    assert.deepEqual(final.map(segment => segment.text), segmentation.segmentAssistantReplyText(text, 'multi-bubble'));
    assert.ok(final.every(segment => segment.completed), '终态关闭所有气泡');
    for (const [index, segment] of previous.entries()) assert.equal(final[index].text, segment.text, '最终提交不重新排段');
  }
  console.log('Prompt chat segmentation 检查通过（单气泡、多气泡与长文本切分不丢正文）。');
}

const checks = {
  locale: verifyLocale,
  'chat-envelope': verifyChatEnvelope,
};

assert.ok(checks[mode], `未知检查模式：${mode || '(empty)'}`);
await checks[mode]();
