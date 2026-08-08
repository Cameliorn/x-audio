import * as assert from 'assert';
import { buildRoleAnalysisMessages } from '../../src/roleAnalyzerPrompts';

suite('roleAnalyzerPrompts.buildRoleAnalysisMessages', () => {
  test('uses built-in system + user messages when no custom prompt', () => {
    const messages = buildRoleAnalysisMessages('', {
      chunk: '你好。',
      knownCharacters: {},
      strictJsonOnly: false
    });

    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.ok(messages[0].content.includes('资深有声书导演'));
    assert.equal(messages[1].role, 'user');
    assert.ok(messages[1].content.includes('你好。'));
  });

  test('injects voice/emotion/tone enumerations into the system message', () => {
    const messages = buildRoleAnalysisMessages('', {
      chunk: '你好。',
      knownCharacters: {},
      strictJsonOnly: false
    });

    const system = messages[0].content;
    assert.ok(system.includes('narrator（旁白）'));
    assert.ok(system.includes('elderly（老人）'));
    assert.ok(system.includes('happy、sad'));
    assert.ok(system.includes('sighs'));
  });

  test('includes a few-shot example in the system message', () => {
    const messages = buildRoleAnalysisMessages('', {
      chunk: '你好。',
      knownCharacters: {},
      strictJsonOnly: false
    });

    assert.ok(messages[0].content.includes('示例（输出）'));
    assert.ok(messages[0].content.includes('"speaker":"翠兰"'));
  });

  test('injects known characters into the user message', () => {
    const messages = buildRoleAnalysisMessages('', {
      chunk: '你好。',
      knownCharacters: { 张三: 'male' },
      strictJsonOnly: false
    });

    assert.ok(messages[1].content.includes('"张三"'));
  });

  test('does not corrupt text containing placeholder-like braces', () => {
    const messages = buildRoleAnalysisMessages('', {
      chunk: '他说：{{knownCharacters}}。',
      knownCharacters: { 张三: 'male' },
      strictJsonOnly: false
    });

    assert.ok(messages[1].content.includes('他说：{{knownCharacters}}。'));
  });

  test('uses the custom prompt as a single user message with placeholders', () => {
    const messages = buildRoleAnalysisMessages('模板 {{text}} 已知 {{knownCharacters}}', {
      chunk: '正文',
      knownCharacters: { 张三: 'male' },
      strictJsonOnly: false
    });

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.ok(messages[0].content.includes('模板 正文'));
    assert.ok(messages[0].content.includes('已知 {"张三":"male"}'));
  });

  test('appends a strict JSON reminder on retry', () => {
    const messages = buildRoleAnalysisMessages('', {
      chunk: '你好。',
      knownCharacters: {},
      strictJsonOnly: true
    });

    assert.equal(messages.length, 3);
    assert.ok(messages[2].content.includes('只输出 JSON 数组'));
  });

  test('includes retry feedback message', () => {
    const messages = buildRoleAnalysisMessages('', {
      chunk: '你好。',
      knownCharacters: {},
      strictJsonOnly: false,
      retryFeedback: '上次解析失败'
    });

    assert.equal(messages.length, 3);
    assert.ok(messages[2].content.includes('上次解析失败'));
  });
});
