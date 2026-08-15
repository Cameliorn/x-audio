import * as assert from 'assert';
import { UserVisibleError } from '../../common/errors';
import {
  mergeConsecutiveSegments,
  parseRoleAnalysisResponse,
  splitTextIntoChunks
} from '../../roles/roleAnalyzer';

suite('roleAnalyzer.parseRoleAnalysisResponse', () => {
  test('parses a plain JSON array', () => {
    const segments = parseRoleAnalysisResponse(JSON.stringify([
      { speaker: '旁白', voice: 'narrator', text: '夜色很深。' },
      { speaker: '张三', voice: 'male', text: '你来了。' }
    ]));

    assert.equal(segments.length, 2);
    assert.deepEqual(segments[0], { speaker: '旁白', voice: 'narrator', text: '夜色很深。' });
    assert.deepEqual(segments[1], { speaker: '张三', voice: 'male', text: '你来了。' });
  });

  test('extracts JSON from markdown code fences and extra text', () => {
    const raw = '分析结果如下：\n```json\n[{"speaker":"小红","voice":"girl","text":"走吧。"}]\n```\n以上。';
    const segments = parseRoleAnalysisResponse(raw);

    assert.equal(segments.length, 1);
    assert.equal(segments[0].speaker, '小红');
    assert.equal(segments[0].voice, 'girl');
  });

  test('forces narrator speaker name for narrator voice', () => {
    const segments = parseRoleAnalysisResponse('[{"speaker":"某个人","voice":"narrator","text":"天亮了。"}]');

    assert.equal(segments[0].speaker, '旁白');
  });

  test('falls back to narrator for unknown voice types', () => {
    const segments = parseRoleAnalysisResponse('[{"speaker":"张三","voice":"robot","text":"你好。"}]');

    assert.equal(segments[0].voice, 'narrator');
    assert.equal(segments[0].speaker, '旁白');
  });

  test('uses placeholder name for dialogue without a speaker', () => {
    const segments = parseRoleAnalysisResponse('[{"voice":"female","text":"真的吗？"}]');

    assert.equal(segments[0].speaker, '未知角色');
    assert.equal(segments[0].voice, 'female');
  });

  test('skips invalid items and empty text', () => {
    const segments = parseRoleAnalysisResponse('[null,{"speaker":"张三","voice":"male","text":"  "},{"speaker":"张三","voice":"male","text":"有效。"}]');

    assert.equal(segments.length, 1);
    assert.equal(segments[0].text, '有效。');
  });

  test('throws when there is no JSON array', () => {
    assert.throws(() => parseRoleAnalysisResponse('没有 JSON'), UserVisibleError);
  });

  test('throws when all items are invalid', () => {
    assert.throws(() => parseRoleAnalysisResponse('[{"speaker":"张三"}]'), UserVisibleError);
  });
});

suite('roleAnalyzer.mergeConsecutiveSegments', () => {
  test('merges adjacent segments of the same speaker', () => {
    const merged = mergeConsecutiveSegments([
      { speaker: '旁白', voice: 'narrator', text: '第一段。' },
      { speaker: '旁白', voice: 'narrator', text: '第二段。' },
      { speaker: '张三', voice: 'male', text: '对白。' }
    ]);

    assert.equal(merged.length, 2);
    assert.equal(merged[0].text, '第一段。\n第二段。');
    assert.equal(merged[1].speaker, '张三');
  });
});

suite('roleAnalyzer.splitTextIntoChunks', () => {
  test('keeps short text in a single chunk', () => {
    assert.deepEqual(splitTextIntoChunks('第一段。\n第二段。', 1000), ['第一段。\n第二段。']);
  });

  test('splits at paragraph boundaries', () => {
    const chunks = splitTextIntoChunks('aaaa\nbbbb\ncccc', 9);

    assert.deepEqual(chunks, ['aaaa\nbbbb', 'cccc']);
  });

  test('hard splits long paragraphs at punctuation', () => {
    const chunks = splitTextIntoChunks('第一句。第二句。第三句。第四句。', 12);

    assert.ok(chunks.length >= 2);
    assert.ok(chunks.every(chunk => chunk.length <= 12));
    assert.equal(chunks.join(''), '第一句。第二句。第三句。第四句。');
  });

  test('returns an empty array for blank text', () => {
    assert.deepEqual(splitTextIntoChunks('  \n  ', 1000), []);
  });
});
