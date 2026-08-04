import * as vscode from 'vscode';

export type RoleAnalysisProvider = 'copilot' | 'openai';

export interface RoleAnalysisConfig {
  readonly provider: RoleAnalysisProvider;
  readonly copilotModelId: string;
  readonly openaiEndpoint: string;
  readonly openaiModel: string;
  readonly customPrompt: string;
  readonly requestTimeoutMs: number;
}

/** 通用配置（audioplugin.*），与具体 TTS 渠道无关 */
export interface TtsConfig {
  readonly cacheEnabled: boolean;
  readonly cacheMaxSizeMb: number;
  readonly maxTextLength: number;
  readonly requestTimeoutMs: number;
  readonly maxConcurrentRequests: number;
  readonly browserPath: string;
  readonly soundEffectsDir: string;
  readonly roleAnalysis: RoleAnalysisConfig;
}

export const DEFAULT_CONFIG: TtsConfig = {
  cacheEnabled: true,
  cacheMaxSizeMb: 512,
  maxTextLength: 10000,
  requestTimeoutMs: 60000,
  maxConcurrentRequests: 3,
  browserPath: '',
  soundEffectsDir: '',
  roleAnalysis: {
    provider: 'openai' as RoleAnalysisProvider,
    copilotModelId: '',
    openaiEndpoint: 'https://api.deepseek.com',
    openaiModel: 'deepseek-chat',
    requestTimeoutMs: 60000,
    customPrompt: `你是一名资深有声书导演，兼具作家的文学鉴赏力和导演的表演指导能力。请通读下面的小说文本，从整体上把握叙事节奏、场景氛围和人物性格后，将其拆分为连续的朗读片段。

作为导演，你需要理解：
- 叙事节奏：哪里是平缓的叙述，哪里是紧张的冲突，哪里是情绪的高潮或转折。
- 场景氛围：当前场景的环境基调（宁静、压抑、欢快、肃杀等）决定了旁白的语气。
- 人物性格：每个角色有独特的说话方式——沉稳的人语速偏慢，急躁的人语速偏快，温柔的人语调柔和。
- 对白潜台词：角色说出来的话和真正想表达的情绪可能不同，请按潜台词的真实情绪来标注 emotion。
- 有声书适配：原文是书面语，不一定适合直接朗读。作为导演，在少数情况下可以为片段添加简短的过渡衔接语。

要求：
1. 只输出 JSON 数组，不要输出任何解释、注释或 Markdown 代码块。
2. 数组元素格式：{"speaker":"角色名","voice":"类型","text":"原文片段","emotion":"情绪","speed":1.0,"pitch":0,"vol":1.0,"soundTags":[],"pauseBefore":0,"transition":""}。
3. voice 只能是这些值之一：narrator（旁白）、male（成年男性）、female（成年女性）、girl（少女）、boy（少年）、child（幼童）、elderly（老人）。
4. emotion 根据上下文的真实情绪判断（注意潜台词），可选值：{{emotions}}。旁白根据场景氛围选择。如设 "neutral" 则不传递情绪参数，让模型根据文本自动处理。
5. speed 语速倍率（0.5~2.0）。调整语速要非常慎重，绝大多数片段保持默认 1.0 即可。仅当角色性格或情绪明显需要时才微调（如极度愤怒 1.1~1.2，极度悲伤 0.85~0.9）。例外：如果片段内容为拟声词（如"啊啊啊"、"嘿嘿"、"呜呜"、"嗯嗯"等）或呻吟/叫喊声，这些内容正常语速读出来会非常怪异，可以适当设为 1.1～1.2 倍速，并调高 Pitch 1。一般情况不调整。
6. pitch 语调偏移（-12~12）。调整语调要非常慎重，绝大多数片段保持默认 0 即可。仅当角色特质明显需要时才微调（如老人略低沉 -3~-1，幼童略偏高 2~4），一般情况不调整。
7. vol 音量倍率（0.1~10）。调整音量要非常慎重，绝大多数片段保持默认 1.0 即可。仅当场景明显需要时才调整（如大喊 1.5~2，耳语 0.4~0.6），一般情况不调整。
8. soundTags 是语气音效标签数组，用于在朗读前添加语气效果，可选值：{{toneTags}}。例如角色叹气时说台词用 ["sighs"]，笑时说 ["laughs"]。仅在语境明确需要时添加，旁白一般为空数组 []。
9. pauseBefore 是该片段前的停顿秒数（0~5），用于控制整体节奏。场景切换或情绪转折时适当延长停顿（0.5~1.0），日常对话中说话人自然切换用较短停顿（0.2~0.4），同一角色连续说话时不加停顿。
10. transition 是导演添加的过渡衔接语。⚠️ 此项必须克制。大多数片段不需要，一律留空字符串 ""。只有当原文存在明显的场景跳跃、时间跨越或视角突变，且停顿（pauseBefore）不足以让听众理解转换时，才可添加一句极简的过渡（不超过 15 字），如"镜头一转……"、"数日后……"。错加、滥加过渡语比不添加更破坏听感。不确认是否该加时，一律不加。
11. 对白要根据上下文推断说话人；同一角色必须使用相同的名字和 voice，保持人物性格和说话风格的一致性。已知角色表：{{knownCharacters}}（为 {} 表示尚未识别任何角色，已知角色必须沿用表中的名字和 voice）。
12. text 原文片段本身不得改写、增补或删减。transition 和 text 是分开的：text 保持原样，导演的衔接语写在 transition 中。所有 text 按原文顺序拼接后应完整覆盖输入文本。
13. 确实无法确定说话人的对白，speaker 使用 "{{unknownSpeaker}}"，并根据语境为其推断最合适的各项参数。{{strictReminder}}

待拆分文本：
"""
{{text}}
"""`
  }
};

export function getTtsConfig(): TtsConfig {
  const settings = vscode.workspace.getConfiguration('audioplugin');

  return {
    cacheEnabled: settings.get<boolean>('cacheEnabled', DEFAULT_CONFIG.cacheEnabled),
    cacheMaxSizeMb: readNonNegativeNumber(settings, 'cacheMaxSizeMb', DEFAULT_CONFIG.cacheMaxSizeMb),
    maxTextLength: readPositiveInt(settings, 'maxTextLength', DEFAULT_CONFIG.maxTextLength),
    requestTimeoutMs: readPositiveInt(settings, 'requestTimeoutMs', DEFAULT_CONFIG.requestTimeoutMs),
    maxConcurrentRequests: readPositiveInt(settings, 'maxConcurrentRequests', DEFAULT_CONFIG.maxConcurrentRequests),
    browserPath: readString(settings, 'browserPath', DEFAULT_CONFIG.browserPath),
    soundEffectsDir: readString(settings, 'soundEffectsDir', DEFAULT_CONFIG.soundEffectsDir),
    roleAnalysis: getRoleAnalysisConfig(settings)
  };
}

export function getRoleAnalysisConfig(settings: vscode.WorkspaceConfiguration): RoleAnalysisConfig {
  return {
    provider: readRoleAnalysisProvider(
      settings.get<string>('roleAnalysis.provider'),
      DEFAULT_CONFIG.roleAnalysis.provider
    ),
    copilotModelId: readString(
      settings,
      'roleAnalysis.copilotModelId',
      DEFAULT_CONFIG.roleAnalysis.copilotModelId
    ),
    openaiEndpoint: readNonEmptyString(
      settings.get<string>('roleAnalysis.openaiEndpoint'),
      DEFAULT_CONFIG.roleAnalysis.openaiEndpoint
    ),
    openaiModel: readNonEmptyString(
      settings.get<string>('roleAnalysis.openaiModel'),
      DEFAULT_CONFIG.roleAnalysis.openaiModel
    ),
    requestTimeoutMs: readPositiveInt(
      settings,
      'requestTimeoutMs',
      DEFAULT_CONFIG.requestTimeoutMs
    ),
    customPrompt: readNonEmptyString(
      settings.get<string>('roleAnalysis.customPrompt'),
      DEFAULT_CONFIG.roleAnalysis.customPrompt
    )
  };
}

function readRoleAnalysisProvider(value: string | undefined, fallback: RoleAnalysisProvider): RoleAnalysisProvider {
  if (value === 'copilot' || value === 'openai') {
    return value;
  }
  return fallback;
}

function readNonEmptyString(value: string | undefined, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return fallback;
}

function readString(settings: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = settings.get<string>(key, fallback).trim();
  return value.length > 0 ? value : fallback;
}

function readNonNegativeNumber(settings: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = settings.get<number>(key, fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readPositiveInt(settings: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = settings.get<number>(key, fallback);
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}
