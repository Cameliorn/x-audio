import * as assert from 'assert';
import { DOUBAO_PROMPT_MAX_LENGTH, validateScenePrompt } from '../../src/doubaoScene';

suite('DoubaoScene', () => {
  test('rejects empty prompts', () => {
    assert.ok(validateScenePrompt(''));
    assert.ok(validateScenePrompt('   \n  '));
  });

  test('rejects prompts longer than the model limit', () => {
    assert.ok(validateScenePrompt('a'.repeat(DOUBAO_PROMPT_MAX_LENGTH + 1)));
  });

  test('accepts prompts within the model limit', () => {
    assert.equal(validateScenePrompt('深夜的废弃工厂，雨滴打在铁皮屋顶，远处雷声渐近。'), undefined);
    assert.equal(validateScenePrompt('a'.repeat(DOUBAO_PROMPT_MAX_LENGTH)), undefined);
  });
});
