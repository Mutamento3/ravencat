/** 语音提供方协议、能力、配置提交和临时测试生命周期的行为验证。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function load(file, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `${file} 缺少依赖 ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const speechRoot = 'src/features/speech/';
const catalog = load(`${speechRoot}application/SpeechProviderCatalog.ts`);
const speechText = load(`${speechRoot}application/SpeechText.ts`);
const callPrompts = load('src/features/calls/application/CallPromptBlocks.ts');
const callStreams = load('src/features/calls/application/runtime/CallSpeechSentenceStream.ts', {
  '@features/speech': { ...speechText, ...catalog }, '../CallPromptBlocks': callPrompts,
});
const draftModule = load('src/features/assistants/presentation/auxiliaryModels/speechModelDraft.ts', { '@features/speech': catalog });
const encoding = load(`${speechRoot}infrastructure/speechAudioEncoding.ts`);
const ai = { normalizeAIBaseURL: (url) => url.replace(/\/$/, ''), getErrorDisplayInfo: (error) => ({ message: error instanceof Error ? error.message : error }) };
const openai = load(`${speechRoot}infrastructure/OpenAISpeechClient.ts`, { '@platform/ai': ai, './speechAudioEncoding': encoding });
const minimax = load(`${speechRoot}infrastructure/MiniMaxSpeechClient.ts`, { '@platform/ai': ai });
const eleven = load(`${speechRoot}infrastructure/ElevenLabsSpeechClient.ts`, { './speechAudioEncoding': encoding });
const gateway = load(`${speechRoot}infrastructure/SpeechSynthesisGateway.ts`, { './OpenAISpeechClient': openai, './MiniMaxSpeechClient': minimax, './ElevenLabsSpeechClient': eleven, '../application/SpeechProviderCatalog': catalog });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const requests = [];
const originalFetch = globalThis.fetch;
const originalSocket = globalThis.WebSocket;
try {
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, json: async () => ({ base_resp: { status_code: 0 }, data: { audio: '010203' } }) };
  };
  const synthesize = (provider, model, metadata, delivery = {}) => gateway.synthesizeSpeechAudio({ baseURL: catalog.getSpeechProvider(provider).baseURL, apiKey: 'test-key', model, metadataJson: null }, { provider, ...metadata }, '你好', delivery);
  assert.equal((await synthesize('openai', 'gpt-4o-mini-tts', { voiceId: 'coral', instructions: '温柔' }, { speed: 1.1 })).audioBase64, 'AQID');
  assert.equal(requests.at(-1).url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(requests.at(-1).body.instructions, '温柔');
  await synthesize('openrouter', 'openai/gpt-4o-mini-tts-2025-12-15', { voiceId: 'coral' }, { instructions: '轻声', speed: 0.8 });
  assert.equal(requests.at(-1).url, 'https://openrouter.ai/api/v1/audio/speech');
  assert.equal(requests.at(-1).body.instructions, '轻声');
  assert.equal(requests.at(-1).body.provider, undefined);
  assert.equal(requests.at(-1).body.response_format, 'mp3');
  await synthesize('minimaxT2aV2', 'speech-2.8-hd', { voiceId: 'voice', emotion: 'happy', pitch: 0, speed: 1 }, { emotion: 'calm', speed: 0.8 });
  assert.equal(requests.at(-1).url, 'https://api.minimax.cn/v1/t2a_v2');
  assert.deepEqual(requests.at(-1).body.voice_setting, { voice_id: 'voice', speed: 0.8, pitch: 0, emotion: 'calm' });
  await synthesize('elevenlabs', 'eleven_v4', { voiceId: 'voice/id', stability: 0, similarityBoost: 0.5, speed: 1, style: 1, speakerBoost: true }, { audioTag: 'whispers' });
  assert.equal(requests.at(-1).headers['xi-api-key'], 'test-key');
  assert.ok(requests.at(-1).url.includes('voice%2Fid?output_format=mp3_44100_128'));
  assert.equal(requests.at(-1).body.text, '[whispers] 你好');
  assert.deepEqual(requests.at(-1).body.voice_settings, { stability: 0, similarity_boost: 0.5 });
  await synthesize('elevenlabs', 'eleven_multilingual_v2', { voiceId: 'voice', speakerBoost: false, speed: 1.2 });
  assert.deepEqual(requests.at(-1).body.voice_settings, { use_speaker_boost: false, speed: 1.2 });
  assert.ok(!catalog.getSpeechParameters('elevenlabs', 'eleven_v4').some((field) => field.key === 'speed'));
  assert.ok(!catalog.getSpeechParameters('openai', 'tts-1').some((field) => field.key === 'instructions'));
  assert.ok(!catalog.getSpeechParameters('minimaxT2aV2', 'speech-2.8-hd').find((field) => field.key === 'emotion').options.includes('whisper'));

  // 控制标记留在提供方输入，canonical 转写只包含正文；不把错误语法降级成朗读文本。
  const textCases = [
    ['minimaxT2aV2', 'speech-2.8-hd', '嗯，(laughs)<#0.5#>我在听。', '嗯， 我在听。'],
    ['minimaxT2aV2', 'speech-2.6-turbo', 'Hello<#0.25#>world.', 'Hello world.'],
    ['minimaxT2aV2', 'speech-02-hd', '先说一句。<#99.99#>再说一句。', '先说一句。 再说一句。'],
    ['elevenlabs', 'eleven_v4', '[whispers] 嗯，我在。[short pause] 你说吧。[sighs]', '嗯，我在。 你说吧。'],
    ['elevenlabs', 'eleven_v4_turbo', '啊，[laughs] 原来这样。', '啊， 原来这样。'],
    ['elevenlabs', 'eleven_v3', '[curious] 真的吗？[long pause] 再说说。', '真的吗？ 再说说。'],
    ...['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'].map((model) =>
      ['elevenlabs', model, '嗯，<break time="0.5s" />我想想。', '嗯， 我想想。']),
    ['openai', 'gpt-4o-mini-tts', '嗯……啊，我知道了。', '嗯……啊，我知道了。'],
    ['openrouter', 'mistralai/voxtral-mini-tts-2603', '唔，等一下——好了。', '唔，等一下——好了。'],
    ['openaiCompatible', 'custom-model', '嗯，  我在。', '嗯，  我在。'],
  ];
  for (const [provider, model, text, transcript] of textCases) {
    assert.deepEqual(speechText.prepareSpeechText(text, provider, model), { synthesisText: text, transcript });
    await gateway.synthesizeSpeechAudio({ baseURL: catalog.getSpeechProvider(provider).baseURL || 'https://custom.example/v1', apiKey: 'test-key', model, metadataJson: null }, { provider, voiceId: 'voice' }, text, {});
    assert.equal(requests.at(-1).body.text ?? requests.at(-1).body.input, text);
  }
  for (const [provider, model, text] of [
    ['minimaxT2aV2', 'speech-2.6-hd', '(laughs) 你好'],
    ['minimaxT2aV2', 'speech-2.8-hd', '你好<#0#>呀'],
    ['minimaxT2aV2', 'speech-2.8-hd', '你好<#100#>呀'],
    ['minimaxT2aV2', 'speech-2.8-hd', '你好<#0.001#>呀'],
    ['minimaxT2aV2', 'speech-2.8-hd', '<#0.5#>你好'],
    ['minimaxT2aV2', 'speech-2.8-hd', '你好<#0.5#>'],
    ['minimaxT2aV2', 'speech-2.8-hd', '你好<#0.5#>(sighs)<#0.5#>呀'],
    ['elevenlabs', 'eleven_v4', '你好<break time="0.5s" />呀'],
    ['elevenlabs', 'eleven_v3', '[standing] 你好'],
    ['elevenlabs', 'eleven_multilingual_v2', '[laughs] 你好'],
    ['elevenlabs', 'eleven_flash_v2_5', '你好<break time="3.1s" />呀'],
    ['openai', 'tts-1', '[whispers] 你好'],
    ['openrouter', 'mistralai/voxtral-mini-tts-2603', '你好<#0.5#>呀'],
    ['openaiCompatible', 'gpt-4o-mini-tts', '[laughs] 你好'],
    ['elevenlabs', 'future-model', '[laughs] 你好'],
    ['elevenlabs', 'eleven_v4', '[laughs]'],
    ['elevenlabs', 'eleven_v4', '你好[short pause'],
    ['minimaxT2aV2', 'speech-2.8-hd', '你好<#0.5'],
  ]) assert.throws(() => speechText.prepareSpeechText(text, provider, model));
  const elevenSpeed = catalog.getSpeechParameters('elevenlabs', 'eleven_multilingual_v2').find((field) => field.key === 'speed');
  assert.deepEqual([elevenSpeed.min, elevenSpeed.max], [0.7, 1.2]);

  // 切换提供方不继承旧密钥或参数；连接字段作为一个整体提交，名称独立保存。
  const initial = draftModule.getSpeechModelDraft('tts', { name: '原配置', enabled: true, baseUrl: 'https://custom.example/v1', apiKey: 'old', model: 'speech-2.8-hd', metadataJson: JSON.stringify({ provider: 'minimaxT2aV2', voiceId: 'old-voice' }) });
  const edited = { ...initial, speed: '0.8' };
  assert.equal(draftModule.buildSpeechDraftConfiguration(edited).baseURL, 'https://custom.example/v1');
  const changed = { ...edited, ...draftModule.switchSpeechProvider('elevenlabs') };
  assert.equal(changed.apiKey, '');
  const invalid = draftModule.parseSpeechModelDraft('tts', { ...changed, name: '新名称' }, ['provider', 'name']);
  assert.deepEqual(invalid.patch, { name: '新名称' });
  assert.ok(invalid.errors.voiceId);
  const pendingKey = draftModule.parseSpeechModelDraft('tts', { ...changed, apiKey: 'new-provider-key' }, ['provider', 'model', 'voiceId', 'apiKey']);
  assert.equal(pendingKey.patch.apiKey, undefined, '新提供方配置未完成时，不能把新密钥保存到旧连接');
  assert.equal(pendingKey.accepted.includes('apiKey'), false);
  changed.voiceId = 'new-voice';
  const parsed = draftModule.parseSpeechModelDraft('tts', changed, ['provider', 'model', 'voiceId', 'apiKey']);
  const saved = JSON.parse(parsed.patch.metadataJson);
  assert.equal(saved.provider, 'elevenlabs');
  assert.equal(saved.speed, undefined);
  assert.equal(parsed.patch.baseUrl, 'https://api.elevenlabs.io/v1');
  assert.equal(parsed.patch.apiKey, null);
  const completeSwitch = draftModule.parseSpeechModelDraft('tts', { ...changed, apiKey: 'new-provider-key' }, ['provider', 'model', 'voiceId', 'apiKey']);
  assert.equal(completeSwitch.patch.apiKey, 'new-provider-key');
  assert.equal(JSON.parse(completeSwitch.patch.metadataJson).provider, 'elevenlabs');
  assert.ok(draftModule.parseSpeechModelDraft('tts', { ...edited, speed: '错误' }, ['speed']).errors.speed);
  const damaged = draftModule.getSpeechModelDraft('tts', { name: '损坏配置', enabled: true, baseUrl: 'x', apiKey: '', model: '', metadataJson: '{broken' });
  assert.ok(draftModule.parseSpeechModelDraft('tts', damaged, ['provider']).errors.provider);
  const modelsById = new Map([
    ['eleven', { id: 'eleven', capabilityKind: 'tts', enabled: true, name: 'Eleven', baseUrl: 'https://api.elevenlabs.io/v1', apiKey: 'key', model: 'eleven_v4', metadataJson: '{"provider":"elevenlabs","voiceId":"voice"}' }],
    ['ali', { id: 'ali', capabilityKind: 'stt', enabled: true, name: '阿里', baseUrl: 'wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference', apiKey: 'key', model: 'fun-asr-realtime', metadataJson: '{"provider":"dashscopeRealtimeAsr","workspaceId":"workspace","region":"beijing"}' }],
    ['invalid', { id: 'invalid', capabilityKind: 'stt', enabled: true, name: '错误', baseUrl: 'https://example/v1', apiKey: 'key', model: 'file-stt', metadataJson: '{"provider":"openaiCompatible"}' }],
  ]);
  const repository = { getModelConfigById: async (id) => modelsById.get(id), listModelConfigs: async () => [...modelsById.values()] };
  const availability = load('src/features/assistants/AuxiliaryModelAvailability.ts', {
    '@features/speech': catalog, '@features/integrations': load('src/features/integrations/domain/TranslationModel.ts'),
  });
  const assets = load('src/features/assistants/ResolveAuxiliaryModel.ts', {
    './infrastructure/SQLiteAuxiliaryModelRepository': { auxiliaryModelRepository: repository }, './AuxiliaryModelAvailability': availability,
  });
  assert.equal((await assets.resolveAuxiliaryModel({ modelConfigId: 'ali', capabilityKind: 'stt' })).modelConfigId, 'ali');
  assert.equal((await assets.resolveAuxiliaryModel({ modelConfigId: 'eleven', capabilityKind: 'tts' })).modelConfigId, 'eleven');
  assert.equal(await assets.resolveAuxiliaryModel({ modelConfigId: 'invalid', capabilityKind: 'stt' }), null);
  modelsById.get('eleven').enabled = false;
  assert.equal((await assets.getAuxiliaryModelSelection({ modelConfigId: 'eleven', capabilityKind: 'tts' })).status, 'unavailable');

  // 官方目录使用各自的鉴权及分页，不把实时 STT 指向文件转写接口。
  const discovery = load(`${speechRoot}infrastructure/SpeechProviderOptions.ts`, { '../application/SpeechProviderCatalog': catalog });
  const directoryCalls = [];
  globalThis.fetch = async (url, options) => {
    directoryCalls.push({ url, options });
    const data = url.includes('openrouter') ? { data: [{ id: 'openai/gpt-4o-mini-tts-2025-12-15', name: 'OpenAI TTS' }] }
      : url.endsWith('/models') ? [{ model_id: 'eleven_v4', name: 'Eleven v4', supports_text_to_speech: true }, { model_id: 'sts', name: 'STS', supports_text_to_speech: false }]
        : url.includes('next_page_token') ? { voices: [{ voice_id: 'b', name: '第二音色' }], has_more: false }
          : { voices: [{ voice_id: 'a', name: '第一音色' }], has_more: true, next_page_token: 'page 2' };
    return { ok: true, json: async () => data };
  };
  const directoryConfig = { baseURL: 'https://api.elevenlabs.io/v1', apiKey: 'key', model: 'eleven_v4', metadataJson: '{"provider":"elevenlabs"}' };
  const directory = await discovery.listSpeechProviderOptions(directoryConfig);
  assert.deepEqual(directory.voices.map((voice) => voice.value), ['a', 'b']);
  assert.equal(directory.models.length, 1);
  assert.ok(directoryCalls.some(({ url }) => url.includes('/v2/voices?page_size=100&next_page_token=page%202')));
  assert.equal(directoryCalls[0].options.headers['xi-api-key'], 'key');
  await discovery.listSpeechProviderOptions({ ...directoryConfig, baseURL: 'https://openrouter.ai/api/v1', metadataJson: '{"provider":"openrouter"}' });
  assert.ok(directoryCalls.at(-1).url.endsWith('/models?output_modalities=speech'));
  assert.equal(directoryCalls.at(-1).options.headers.Authorization, 'Bearer key');
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

  // 模型输出在 Runtime 按 schema 验证；工具持有能力与执行模型的同一个快照。
  let selectedVoice = { ...directoryConfig, modelConfigId: 'first', modelConfigName: '第一配置' };
  const synthesized = [];
  const voiceTool = load('src/features/chat/reply/agent/SendVoiceMessageTool.ts', {
    '@features/speech': { ...catalog, ...speechText, resolveTextToSpeechModel: async () => selectedVoice, synthesizeTextToSpeech: async (params) => { synthesized.push(params); return { success: true, audioUri: 'temp://tool', mimeType: 'audio/mpeg' }; } },
    '@features/media': { MEDIA_ASSET_STORAGE_BACKEND: { persistentMedia: 'persistent' }, prepareMediaAssetBatch: async () => ({ ready: true }) },
    '@platform/device': { readLocalAudioMetadata: async () => ({ durationMs: 1000 }), temporarySpeechAudioStore: { deleteIfExists: async () => {} } },
    '@shared/runtime/abortSignal': { throwIfAbortSignalAborted: (signal) => { if (signal.aborted) throw new Error('已取消'); } },
  });
  const configuredTool = await voiceTool.createConfiguredVoiceMessageTool('assistant');
  assert.ok(configuredTool.definition.parameters.properties.audioTag.enum.includes('whispers'));
  assert.equal(configuredTool.definition.parameters.properties.speed, undefined);
  selectedVoice = { ...directoryConfig, model: 'eleven_multilingual_v2', modelConfigId: 'second' };
  const sent = await configuredTool.execute({ text: '你好', audioTag: 'whispers' }, { task: { assistantId: 'assistant' }, abortSignal: new AbortController().signal, toolCallId: 'test' });
  assert.equal(synthesized[0].modelSnapshot.modelConfigId, 'first');
  assert.equal(synthesized[0].delivery.audioTag, 'whispers');
  assert.equal(sent.data.transcript, '你好');
  const expressive = await configuredTool.execute({ text: '[whispers] 嗯，我在。[short pause] 你说吧。' }, { task: { assistantId: 'assistant' }, abortSignal: new AbortController().signal, toolCallId: 'expression' });
  assert.equal(expressive.data.transcript, '嗯，我在。 你说吧。');
  assert.equal(synthesized.at(-1).text, '[whispers] 嗯，我在。[short pause] 你说吧。');
  const synthesisCount = synthesized.length;
  const invalidText = await configuredTool.execute({ text: '你好<break time="0.5s" />呀' }, { task: { assistantId: 'assistant' }, abortSignal: new AbortController().signal, toolCallId: 'invalid' });
  assert.equal(invalidText.code, 'VOICE_TEXT_INVALID');
  assert.equal(synthesized.length, synthesisCount);

  // 通话标记可以跨任意 delta；句间停顿和两侧正文必须同次合成，结束标记不进入声音或字幕。
  const plainCallSentences = [];
  const plainCallStream = callStreams.createCallSpeechSentenceStream((sentence) => plainCallSentences.push(sentence), null);
  plainCallStream.push('嗯，🙂我在。你说吧。');
  plainCallStream.flush();
  assert.deepEqual(plainCallSentences, ['嗯，我在。', '你说吧。']);
  for (const [provider, model, text] of [
    ['minimaxT2aV2', 'speech-2.8-hd', '[[END_CALL]]嗯，(laughs)我在。<#0.5#>你说吧。晚安。'],
    ['elevenlabs', 'eleven_v4', '[[END_CALL]][whispers]我在。[short pause]你说吧。晚安。'],
    ['elevenlabs', 'eleven_multilingual_v2', '[[END_CALL]]我在。<break time="0.5s" />你说吧。晚安。'],
  ]) {
    const snapshot = { ...directoryConfig, model, metadataJson: JSON.stringify({ provider, voiceId: 'voice' }), modelConfigId: 'call-voice', modelConfigName: '通话声音' };
    const runStream = (chunks) => {
      const sentences = [];
      const stream = callStreams.createCallSpeechSentenceStream((transcript, speech) => sentences.push({ transcript, speech }), snapshot);
      for (const chunk of chunks) stream.push(chunk);
      stream.flush();
      assert.equal(stream.shouldEndCall(), true);
      assert.deepEqual(stream.getSentences(), sentences.map((sentence) => sentence.transcript));
      assert.equal(sentences.length, 2);
      assert.ok(sentences[0].speech.synthesisText.includes('你说吧。'));
      assert.equal(sentences[1].transcript, '晚安。');
      for (const sentence of sentences) {
        assert.equal(sentence.speech.modelSnapshot, snapshot);
        assert.doesNotMatch(sentence.transcript, /[<>\[\]()]/);
        assert.ok(!sentence.speech.synthesisText.includes('END_CALL'));
      }
      return sentences;
    };
    const expected = runStream([text]);
    assert.deepEqual(runStream([...text]), expected);
    for (let split = 1; split < text.length; split++)
      assert.deepEqual(runStream([text.slice(0, split), text.slice(split)]), expected);
  }

  // 实际回复 owner 固定模型，并把干净正文提交；切换选择不会改变已经产出的 TTS 输入。
  const callEvents = [];
  const callAudio = [];
  const replySnapshot = { ...directoryConfig, modelConfigId: 'call-first', modelConfigName: '通话快照' };
  let currentCallVoice = replySnapshot;
  let observedBlocks;
  const callState = { id: 'call', chatSessionId: 'chat', state: 'active' };
  const callReply = load('src/features/calls/application/runtime/ProcessCallAIReply.ts', {
    '@features/speech': { ...catalog, ...speechText, resolveTextToSpeechModel: async () => currentCallVoice },
    '@platform/ai': { ...ai, createAIClient: () => ({ chatStreamWithTools: async (_messages, _tools, options) => {
      currentCallVoice = { ...replySnapshot, model: 'eleven_multilingual_v2' };
      for (const chunk of ['[whis', 'pers] 我在。', '[short ', 'pause] 你说吧。']) options.onDelta({ type: 'answer_delta', text: chunk });
      return { success: true, text: '[whispers] 我在。[short pause] 你说吧。' };
    } }) },
    '@shared/aiTools': { ToolContext: class {} },
    '@shared/prompt': { DEFAULT_PRIVATE_CONTEXT_PRIMARY_LIMIT: 40 },
    '../snapshots/CallSnapshotLifetime': {},
    '../../aiTools/LookAtUserTool': { LookAtUserTool: { definition: {} } },
    '../events/AppendCallTranscriptEvent': {
      appendUserSpeechText: async ({ text }) => ({ id: 'user', text }),
      appendAISpeechText: async (event) => { callEvents.push(event); return { id: 'ai', ...event }; },
    },
    './CallRuntimeDependencies': { getCallRuntimeDependencies: () => ({ repositories: { calls: { getSessionById: async () => callState } }, assembleChatPromptPack: async (params) => {
      observedBlocks = params.additionalBlocks; return { systemPrompt: '', modelMessages: [] };
    } }) },
    './CallReplyRunState': { isCallReplyCancellationError: () => false },
    './CallSpeechSentenceStream': callStreams,
    '../CallPromptBlocks': callPrompts,
  });
  const callResult = await callReply.processCallAIReply({ callId: 'call', userText: '在吗', aiConfig: { id: 'assistant' }, signal: new AbortController().signal, onSpeechSentence: (transcript, speech) => callAudio.push({ transcript, speech }) });
  assert.equal(callResult.status, 'completed');
  assert.equal(callEvents[0].text, '我在。 你说吧。');
  assert.equal(callAudio[0].speech.synthesisText, '[whispers] 我在。[short pause] 你说吧。');
  assert.equal(callAudio[0].speech.modelSnapshot, replySnapshot);
  assert.ok(observedBlocks.find((block) => block.definitionId === 'output.call_plain_spoken_text').content.includes('[short pause]'));

  // 真实 WS 协议只在官方 ready 后返回；中间结果与最终完成屏障保持独立。
  const sockets = [];
  class FakeSocket {
    constructor(url, protocols, options) { this.url = url; this.options = options; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.onclose?.(); }
    message(event, sentence) { this.onmessage?.({ data: JSON.stringify({ header: { task_id: 'task-id', event }, payload: { output: { sentence } } }) }); }
  }
  globalThis.WebSocket = FakeSocket;
  const device = { createRandomUUID: () => 'task-id' };
  const dashscope = load(`${speechRoot}infrastructure/DashScopeRealtimeASRClient.ts`, { '@platform/device': device });
  const tencent = load(`${speechRoot}infrastructure/TencentRealtimeASRClient.ts`);
  const signer = load(`${speechRoot}infrastructure/tencentRealtimeASRSignature.ts`);
  const resolver = load(`${speechRoot}application/ResolveSpeechModel.ts`);
  const realtime = load(`${speechRoot}StartRealtimeSpeechToText.ts`, { '@platform/ai': ai, '@platform/device': device, './application/SpeechProviderCatalog': catalog, './application/ResolveSpeechModel': resolver, './infrastructure/DashScopeRealtimeASRClient': dashscope, './infrastructure/TencentRealtimeASRClient': tencent, './infrastructure/tencentRealtimeASRSignature': signer });
  const configuration = { baseURL: 'wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference', apiKey: 'key', model: 'paraformer-realtime-v2', metadataJson: JSON.stringify({ provider: 'dashscopeRealtimeAsr', workspaceId: 'workspace', region: 'beijing' }) };
  let resolutionCount = 0;
  resolver.configureSpeechModelResolver(async () => { resolutionCount++; return { ...configuration, modelConfigId: 'selected', modelConfigName: '阿里' }; });
  const finals = []; let finished = false; let starts = 0;
  const connecting = realtime.startRealtimeSpeechToText({ configuration, onFinalTranscript: (result) => finals.push(result), onFinished: () => { finished = true; }, onSpeechStart: () => { starts++; } });
  const socket = sockets.at(-1);
  socket.onopen();
  assert.equal(JSON.parse(socket.sent[0]).payload.parameters.sample_rate, 16000);
  assert.equal(socket.options.headers.Authorization, 'Bearer key');
  assert.equal(resolutionCount, 0, '测试快照不读取或更改正式模型选择');
  socket.message('task-started');
  const connection = await connecting;
  connection.session.sendAudioChunk(new ArrayBuffer(2));
  socket.message('result-generated', { begin_time: 100, end_time: null, text: '你', sentence_end: false });
  socket.message('result-generated', { begin_time: 100, end_time: 200, text: '你好', sentence_end: true });
  assert.equal(starts, 1); assert.equal(finals[0].index, 100);
  connection.session.finish(); assert.equal(finished, false);
  assert.equal(JSON.parse(socket.sent.at(-1)).header.action, 'finish-task');
  socket.message('task-finished'); assert.equal(finished, true); connection.session.close();

  const voice = load(`${speechRoot}VoiceMessageTranscription.ts`, { '@platform/ai': ai, './StartRealtimeSpeechToText': realtime });
  const openingVoice = voice.startVoiceMessageTranscription({});
  await Promise.resolve(); await Promise.resolve();
  const voiceSocket = sockets.at(-1); voiceSocket.onopen(); voiceSocket.message('task-started');
  const voiceSession = await openingVoice;
  voiceSocket.message('result-generated', { begin_time: 300, end_time: 400, text: '世界', sentence_end: true });
  const ending = voiceSession.finish({ uri: 'unused', mimeType: 'unused' });
  voiceSocket.message('result-generated', { begin_time: 100, end_time: 200, text: '你好', sentence_end: true });
  voiceSocket.message('task-finished'); assert.deepEqual(await ending, { success: true, text: '你好世界' });
  const interrupted = dashscope.connectDashScopeRealtimeASR(configuration, { provider: 'dashscopeRealtimeAsr' }, {});
  sockets.at(-1).onclose(); await assert.rejects(interrupted, /提前关闭/);
  const failedTencent = new tencent.TencentRealtimeASRClient({ signedUrl: 'wss://test' }).connect();
  sockets.at(-1).onclose(); await assert.rejects(failedTencent, /closed before final/);
  const badTencent = new tencent.TencentRealtimeASRClient({ signedUrl: 'wss://test' }).connect();
  sockets.at(-1).onmessage({ data: 'not json' }); await assert.rejects(badTencent);

  // 临时音频的取消结果由生成方清理，不交给已离开的页面。
  const deleted = [];
  const store = { writeBase64Audio: async () => ({ uri: 'temp://audio', mimeType: 'audio/mpeg' }), deleteIfExists: async (uri) => { deleted.push(uri); } };
  const configured = load(`${speechRoot}SynthesizeConfiguredSpeech.ts`, { '@platform/device': { temporarySpeechAudioStore: store }, './application/SpeechProviderCatalog': catalog, './infrastructure/SpeechSynthesisGateway': gateway });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(configured.synthesizeConfiguredSpeech({ configuration: { ...configuration, baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', metadataJson: '{"provider":"openai","voiceId":"coral"}' }, text: '你好', signal: controller.signal }), /已取消/);
  assert.deepEqual(deleted, ['temp://audio']);

  // UI 测试通过真实 React 生命周期验证播放清理与迟到响应，不使用源码断言。
  const pending = deferred(); let stops = 0;
  const playback = { stop: async () => { stops++; }, pause: async () => {}, resume: async () => {}, subscribe: (listener) => { listener({ state: 'playing' }); return () => {}; } };
  const theme = { spacing: { lg: 10, md: 8, sm: 4 }, colors: { text: { primary: '#000' }, feedback: { error: '#f00' } } };
  let generation = 0;
  const preview = load(`${speechRoot}presentation/SpeechConfigurationTest.tsx`, {
    react: React, 'react-native': { View: 'View', Text: 'Text' }, '@shared/ui': { Button: 'Button', InputField: 'InputField' }, '@shared/theme': { useTheme: () => theme },
    '@platform/device': { temporarySpeechAudioStore: store, localAudioPlaybackPort: { play: async () => playback } },
    '../SynthesizeConfiguredSpeech': { synthesizeConfiguredSpeech: async () => { generation++; return generation === 1 ? pending.promise : { audioUri: 'temp://new', mimeType: 'audio/mpeg' }; } }, '../StartRealtimeSpeechToText': {},
  });
  let renderer;
  const props = { kind: 'tts', getConfiguration: () => configuration, configurationRevision: '1' };
  await act(async () => { renderer = TestRenderer.create(React.createElement(preview.SpeechConfigurationTest, props)); });
  let generating;
  await act(async () => { generating = renderer.root.findAllByType('Button')[0].props.onPress(); await Promise.resolve(); });
  await act(async () => { renderer.update(React.createElement(preview.SpeechConfigurationTest, { ...props, configurationRevision: '2' })); });
  await act(async () => { pending.resolve({ audioUri: 'temp://late', mimeType: 'audio/mpeg' }); await generating; });
  assert.ok(deleted.includes('temp://late'));
  assert.equal(renderer.root.findAllByType('Button').length, 1);
  await act(async () => { renderer.root.findAllByType('Button')[0].props.onPress(); });
  await act(async () => { renderer.root.findAllByType('Button')[1].props.onPress(); });
  await act(async () => { renderer.unmount(); });
  assert.equal(stops, 1); assert.ok(deleted.includes('temp://new'));

  // STT 设置测试在停止麦克风后发送 finish，并显示屏障前到达的最后一句。
  let audioCallbacks; let recognitionCallbacks; let socketClosed = 0; const events = [];
  const sttPreview = load(`${speechRoot}presentation/SpeechConfigurationTest.tsx`, {
    react: React, 'react-native': { View: 'View', Text: 'Text' }, '@shared/ui': { Button: 'Button', InputField: 'InputField' }, '@shared/theme': { useTheme: () => theme },
    '@platform/device': { temporarySpeechAudioStore: store, requestMicrophonePermission: async () => true, realtimeSpeechAudioSource: { start: async (callbacks) => {
      audioCallbacks = callbacks; let stopped = false;
      return { stop: async () => { if (stopped) return; stopped = true; events.push('microphone-stop'); audioCallbacks.onAudioChunk(new ArrayBuffer(2)); } };
    } } }, '../SynthesizeConfiguredSpeech': {}, '../StartRealtimeSpeechToText': { startRealtimeSpeechToText: async (callbacks) => {
      recognitionCallbacks = callbacks;
      return { success: true, session: { sendAudioChunk: () => events.push('pcm'), finish: () => { events.push('finish'); callbacks.onFinalTranscript({ index: 1, text: '最后一句' }); callbacks.onFinished(); }, close: () => { socketClosed++; } } };
    } },
  });
  await act(async () => { renderer = TestRenderer.create(React.createElement(sttPreview.SpeechConfigurationTest, { ...props, kind: 'stt' })); });
  await act(async () => { renderer.root.findByType('Button').props.onPress(); });
  await act(async () => { recognitionCallbacks.onInterimTranscript({ text: '中间结果' }); });
  await act(async () => { renderer.root.findByType('Button').props.onPress(); });
  assert.deepEqual(events, ['microphone-stop', 'pcm', 'finish']);
  assert.ok(renderer.root.findAllByType('Text').some((node) => node.props.children === '最后一句'));
  assert.equal(socketClosed, 1);
  await act(async () => { renderer.unmount(); });

  // 原生停止期间保留 PCM 订阅，重复停止不会重复操作全局麦克风。
  let chunkListener; let removed = 0; let nativeStops = 0;
  const nativeStop = deferred();
  const source = load('src/platform/device/RealtimeSpeechAudioSource.ts', { '../../../modules/realtime-speech-audio-source': {
    addRealtimeSpeechAudioChunkListener: (callback) => { chunkListener = callback; return { remove: () => { removed++; } }; },
    addRealtimeSpeechAudioErrorListener: () => ({ remove: () => { removed++; } }), addRealtimeSpeechDetectedListener: () => ({ remove: () => { removed++; } }),
    startRealtimeSpeechAudioSource: async () => ({ echoCancellationEnabled: true }), stopRealtimeSpeechAudioSource: async () => { nativeStops++; await nativeStop.promise; },
  } });
  const chunks = [];
  const sourceSession = await source.realtimeSpeechAudioSource.start({ onAudioChunk: (chunk) => chunks.push(chunk), onError: assert.fail });
  const stopSource = sourceSession.stop(); const stopAgain = sourceSession.stop();
  chunkListener({ base64: 'AQI=' }); assert.equal(chunks.length, 1); assert.equal(removed, 0);
  nativeStop.resolve(); await Promise.all([stopSource, stopAgain]); assert.equal(nativeStops, 1); assert.equal(removed, 3);

  console.log('语音提供方协议、动态参数、配置提交、实时识别完成屏障及测试音频生命周期验证通过。');
} finally { globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; }
