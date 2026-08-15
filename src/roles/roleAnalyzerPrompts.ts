import { ChatMessage } from './roleAnalysisClient';

// ─── 角色分析领域常量 ──────────────────────────────────────

export type RoleVoiceType = 'narrator' | 'male' | 'female' | 'girl' | 'boy' | 'child' | 'elderly';

export const ROLE_VOICE_TYPES: readonly RoleVoiceType[] = ['narrator', 'male', 'female', 'girl', 'boy', 'child', 'elderly'];

export const ROLE_VOICE_LABELS: Readonly<Record<RoleVoiceType, string>> = {
  narrator: '旁白',
  male: '成年男性',
  female: '成年女性',
  girl: '少女',
  boy: '少年',
  child: '幼童',
  elderly: '老人'
};

export const NARRATOR_NAME = '旁白';
export const UNKNOWN_SPEAKER_NAME = '未知角色';

/** MiniMax API voice_setting.emotion 支持的值（speech-2.8 系列不支持 whisper）。 */
export type StoryEmotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'calm' | 'fluent';

export const STORY_EMOTIONS: readonly StoryEmotion[] = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent'];

/**
 * MiniMax Speech 2.8 支持的语气词标签（sound tags）。
 * 模型会将文本中的 `(tag)` 渲染为实际音效。
 */
export const TONE_TAGS = [
  'laughs', 'chuckle', 'coughs', 'clear-throat', 'groans', 'breath',
  'pant', 'inhale', 'exhale', 'gasps', 'sniffs', 'sighs',
  'snorts', 'burps', 'lip-smacking', 'humming'
] as const;
export type ToneTag = typeof TONE_TAGS[number];

/** 角色分析提示词模块：内置提示词默认拆分为 system（规则）与 user（动态数据）两条消息；
 * 用户设置 xaudio.roleAnalysis.customPrompt 时整体作为单条 user 消息（保持旧语义）。
 * 领域常量（音色类型、情绪、音效标签）与提示词同处，自动注入避免漂移。 */

const BUILTIN_SYSTEM_PROMPT = `你是一名资深有声书导演，兼具作家的文学鉴赏力和导演的表演指导能力。请通读下面的小说文本，从整体上把握叙事节奏、场景氛围和人物性格后，将其拆分为连续的朗读片段。

作为导演，你需要理解：
- 叙事节奏：哪里是平缓的叙述，哪里是紧张的冲突，哪里是情绪的高潮或转折。
- 场景氛围：当前场景的环境基调（宁静、压抑、欢快、肃杀等）决定了旁白的语气。
- 人物性格：每个角色有独特的说话方式——沉稳的人语速偏慢，急躁的人语速偏快，温柔的人语调柔和。
- 对白潜台词：角色说出来的话和真正想表达的情绪可能不同，请按潜台词的真实情绪来标注 emotion。
- 有声书适配：原文是书面语，不一定适合直接朗读。作为导演，在少数情况下可以为片段添加简短的过渡衔接语。

要求：
1. 只输出 JSON 数组，不要输出任何解释、注释或 Markdown 代码块。
2. 数组元素格式：{"speaker":"角色名","voice":"类型","text":"原文片段","emotion":"情绪","speed":1.0,"pitch":0,"vol":1.0,"soundTags":[],"pauseBefore":0,"transition":""}。
3. voice 只能是这些值之一：{{voiceTypes}}。
4. emotion 根据上下文的真实情绪判断（注意潜台词），可选值：{{emotions}}。旁白根据场景氛围选择。如设 "neutral" 则不传递情绪参数，让模型根据文本自动处理。
5. speed（语速倍率 0.5~2.0）、pitch（语调偏移 -12~12）、vol（音量倍率 0.1~10）：绝大多数片段保持默认 1.0 / 0 / 1.0，仅在情绪或场景明显需要时微调（如大喊 vol 1.5~2、耳语 0.4~0.6，老人 pitch -3~-1、幼童 2~4，极度愤怒 speed 1.1~1.2、极度悲伤 0.85~0.9）。例外：拟声词/呻吟/叫喊（如"啊啊啊"、"嘿嘿"、"呜呜"）正常语速读出来很怪异，可设 speed 1.1~1.2 并调高 pitch。
6. soundTags 是语气音效标签数组，可选值：{{toneTags}}。例如叹气时用 ["sighs"]，笑时用 ["laughs"]。仅在语境明确需要时添加，旁白一般为 []。
7. pauseBefore 是该片段前的停顿秒数（0~5）。场景切换或情绪转折 0.5~1.0，说话人自然切换 0.2~0.4，同一角色连续说话不加停顿。
8. transition 是导演添加的过渡衔接语。⚠️ 此项必须克制：大多数片段留空 ""。仅当原文存在明显的场景跳跃、时间跨越或视角突变，且停顿不足以让听众理解转换时，才可加一句极简过渡（不超过 15 字，如"镜头一转……"、"数日后……"）。错加、滥加过渡语比不添加更破坏听感，不确认时一律不加。
9. 对白要根据上下文推断说话人；同一角色必须使用相同的名字和 voice，保持人物性格和说话风格的一致性。用户消息中给出的已知角色必须沿用其中的名字和 voice。
10. text 原文片段本身不得改写、增补或删减。transition 和 text 分开：text 保持原样，衔接语写在 transition。所有 text 按原文顺序拼接后应完整覆盖输入文本。
11. 确实无法确定说话人的对白，speaker 使用 "{{unknownSpeaker}}"，并根据语境为其推断最合适的各项参数。

示例（输入）：
"""
“张婶，你说他还会回来吗？”翠兰压低声音问。
夜色里，张婶叹了口气：“谁知道呢。走了三年了。”
"""
示例（输出）：
[
  {"speaker":"翠兰","voice":"female","text":"张婶，你说他还会回来吗？","emotion":"fearful","speed":1.0,"pitch":0,"vol":0.6,"soundTags":[],"pauseBefore":0.2,"transition":""},
  {"speaker":"张婶","voice":"elderly","text":"谁知道呢。走了三年了。","emotion":"sad","speed":0.9,"pitch":-2,"vol":1.0,"soundTags":["sighs"],"pauseBefore":0,"transition":""}
]`;

const BUILTIN_USER_TEMPLATE = `已知角色表：{{knownCharacters}}（为 {} 表示尚未识别任何角色，已知角色必须沿用表中的名字和 voice）。

待拆分文本：
"""
{{text}}
"""`;

const STRICT_JSON_REMINDER = '再次提醒：只输出 JSON 数组，不要输出任何其他内容。';

// 哨兵占位符：先保护动态内容，最后再嵌入正文，避免正文中的 {{…}} 被误替换
const TEXT_SENTINEL = '\u0000TEXT\u0000';
const KNOWN_SENTINEL = '\u0000KNOWN\u0000';
const STRICT_SENTINEL = '\u0000STRICT\u0000';

export interface RoleAnalysisPromptInput {
  readonly chunk: string;
  readonly knownCharacters: Readonly<Record<string, RoleVoiceType>>;
  readonly strictJsonOnly: boolean;
  readonly retryFeedback?: string;
}

export function buildRoleAnalysisMessages(
  customPrompt: string,
  input: RoleAnalysisPromptInput
): ChatMessage[] {
  const knownJson = JSON.stringify(input.knownCharacters);
  const emotions = STORY_EMOTIONS.join('、');
  const toneTags = TONE_TAGS.join('、');
  const voiceTypes = ROLE_VOICE_TYPES
    .map(voice => `${voice}（${ROLE_VOICE_LABELS[voice]}）`)
    .join('、');
  const strictReminder = input.strictJsonOnly ? `\n${STRICT_JSON_REMINDER}` : '';

  const messages: ChatMessage[] = [];
  if (customPrompt.trim().length > 0) {
    messages.push({
      role: 'user',
      content: replacePlaceholders(customPrompt, {
        chunk: input.chunk,
        knownJson,
        strictReminder,
        emotions,
        toneTags,
        voiceTypes,
        unknownSpeaker: UNKNOWN_SPEAKER_NAME
      })
    });
  } else {
    messages.push({
      role: 'system',
      content: BUILTIN_SYSTEM_PROMPT
        .replace(/\{\{emotions\}\}/g, emotions)
        .replace(/\{\{toneTags\}\}/g, toneTags)
        .replace(/\{\{voiceTypes\}\}/g, voiceTypes)
        .replace(/\{\{unknownSpeaker\}\}/g, UNKNOWN_SPEAKER_NAME)
    });
    messages.push({
      role: 'user',
      content: buildBuiltinUserMessage(input.chunk, knownJson)
    });
    if (input.strictJsonOnly) {
      messages.push({ role: 'user', content: STRICT_JSON_REMINDER });
    }
  }

  if (input.retryFeedback) {
    messages.push({ role: 'user', content: input.retryFeedback });
  }

  return messages;
}

function buildBuiltinUserMessage(chunk: string, knownJson: string): string {
  return BUILTIN_USER_TEMPLATE
    .replace('{{knownCharacters}}', KNOWN_SENTINEL)
    .replace('{{text}}', TEXT_SENTINEL)
    .split(KNOWN_SENTINEL).join(knownJson)
    .split(TEXT_SENTINEL).join(chunk);
}

interface PromptPlaceholders {
  readonly chunk: string;
  readonly knownJson: string;
  readonly strictReminder: string;
  readonly emotions: string;
  readonly toneTags: string;
  readonly voiceTypes: string;
  readonly unknownSpeaker: string;
}

function replacePlaceholders(template: string, p: PromptPlaceholders): string {
  // 先保护动态内容，最后再嵌入正文，防止正文中的 {{…}} 被误替换
  let result = template
    .replace(/\{\{text\}\}/g, TEXT_SENTINEL)
    .replace(/\{\{knownCharacters\}\}/g, KNOWN_SENTINEL)
    .replace(/\{\{strictReminder\}\}/g, STRICT_SENTINEL)
    .replace(/\{\{emotions\}\}/g, p.emotions)
    .replace(/\{\{toneTags\}\}/g, p.toneTags)
    .replace(/\{\{voiceTypes\}\}/g, p.voiceTypes)
    .replace(/\{\{unknownSpeaker\}\}/g, p.unknownSpeaker);

  result = result.split(STRICT_SENTINEL).join(p.strictReminder);
  result = result.split(KNOWN_SENTINEL).join(p.knownJson);
  return result.split(TEXT_SENTINEL).join(p.chunk);
}
