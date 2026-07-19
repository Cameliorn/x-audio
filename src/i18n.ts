import * as vscode from 'vscode';

type MessageBundle = Readonly<Record<string, string>>;

const zhCn: MessageBundle = {
    // ttsService
    'tts.emptyText': '没有可朗读的文本。',
    'tts.textTooLong': 'MiniMax 文字转语音单次请求最多支持 {0} 个字符。请选择更短的文本。',

    // minimaxClient
    'minimax.emptyAudio': 'MiniMax 返回了空音频数据。',
    'minimax.invalidAudioHex': 'MiniMax 返回了无效的十六进制音频数据。',
    'minimax.requestCancelled': 'MiniMax 文字转语音请求已取消。',
    'minimax.httpError': 'MiniMax 文字转语音请求失败，HTTP 状态码 {0}。',
    'minimax.requestFailed': 'MiniMax 文字转语音请求失败。',
    'minimax.noAudioData': 'MiniMax 文字转语音响应中没有音频数据。',
    'minimax.timeout': 'MiniMax 文字转语音请求在 {0} 秒后超时。',
    'minimax.emptyResponseBody': '响应体为空',
    'minimax.traceId': '追踪 ID: {0}',

    // externalAudioPlayer
    'player.serverStartFailed': '无法启动本地播放器服务。',
    'player.pauseInfo': '播放已暂停。',
    'player.resumeInfo': '播放已恢复。',
    'player.stopInfo': '播放已停止。',
    'player.openFailed': '无法打开外部播放器页面。',
    'player.noBrowser': '无法打开外部播放器页面。请确认系统已安装 Safari、Chrome、Edge 或其他浏览器。',

    // errors
    'errors.missingApiKey': '尚未设置 MiniMax 密钥。请先运行“MiniMax 文字转语音：设置密钥”。',
    'errors.unknown': '发生未知的 MiniMax 文字转语音错误。',

    // roleAnalysisClient
    'roleAnalysis.apiError': '角色分析 API 返回错误 ({0})：{1}',
    'roleAnalysis.emptyContent': '角色分析 API 未返回有效内容。',
    'roleAnalysis.missingApiKey': '尚未设置角色分析 API 密钥。请先运行“MiniMax 文字转语音：设置角色分析 API 密钥”。',

    // roleAnalyzer
    'roleAnalysis.noText': '没有可分析的文本。',
    'roleAnalysis.invalidJson': '语言模型未返回有效的 JSON 数组。',
    'roleAnalysis.parseError': '无法解析语言模型返回的 JSON。',
    'roleAnalysis.notArray': '语言模型返回的角色分析结果不是数组。',
    'roleAnalysis.emptyResult': '语言模型返回的角色分析结果为空。',
    'roleAnalysis.noValidResult': '语言模型未返回有效的角色分析结果。',

    // extension
    'extension.noEditor': '请先打开编辑器并选中要朗读的文本。',
    'extension.noSelection': '请先选中要朗读的文本。',
    'extension.speakProgress': '正在生成 MiniMax 语音',
    'extension.speakInputTitle': 'MiniMax 文字转语音：朗读输入文本',
    'extension.speakInputPrompt': '输入要转换为语音的文本。',
    'extension.textEmpty': '文本不能为空。',
    'extension.noEditorForRoles': '请先打开包含小说文本的编辑器。',
    'extension.noText': '没有可朗读的文本。',
    'extension.roleAnalysisProgress': '正在使用 {0} 分析小说角色',
    'extension.roleAnalysisChunk': '已分析 {0}/{1} 段',
    'extension.synthesizeProgress': '正在生成 MiniMax 多角色语音',
    'extension.synthesizeComplete': 'MiniMax 多角色朗读：已生成 {0} 个音频片段，共 {1} 字。',
    'extension.startSynthesis': '$(check) 开始合成语音',
    'extension.roleSummary': '{0} 名角色，约 {1} 字，将消耗 MiniMax 额度',
    'extension.voiceIdLabel': '音色 {0}{1}',
    'extension.dirConfigLabel': ' · 目录配置',
    'extension.voiceTypeLabel': '类型：{0}',
    'extension.confirmRolesTitle': '确认小说角色与音色',
    'extension.confirmRolesPlaceholder': '选择角色可修改音色；确认无误后选择“开始合成语音”。',
    'extension.modifyVoiceTitle': '修改「{0}」的音色',
    'extension.modifyVoicePrompt': '输入 MiniMax 音色 ID。',
    'extension.voiceIdEmpty': '音色 ID 不能为空。',
    'extension.cacheHit': '缓存',
    'extension.cacheMiss': '新生成',
    'extension.speakComplete': 'MiniMax 文字转语音：已在外部播放器打开 {0} 个字符（{1}）',
    'extension.setKey': '设置密钥',
    'extension.apiEndpointTitle': 'API 地址',
    'extension.cannotBeEmpty': '不能为空。',
    'extension.modelNameTitle': '模型名',
    'extension.keepExistingKey': '留空则保留现有密钥',
    'extension.roleAnalysisConfigured': '角色分析：{0} @ {1}',
    'extension.setSoundEffectsDirTitle': '选择音效素材库文件夹',
    'extension.soundEffectsDirSet': '音效素材库已设置为：{0}',

    // secretManager
    'secretManager.setKeyTitle': '设置 MiniMax 密钥',
    'secretManager.setKeyPrompt': '粘贴用于 MiniMax 语音合成的密钥。语音订阅（Audio Subscription）请使用“账户 > API 密钥”（Account > API Keys）中的 API Platform key；Token Plan/Credits 请使用“计费 > Token Plan”（Billing > Token Plan）中的 Subscription Key。',
    'secretManager.keyEmpty': 'MiniMax 密钥不能为空。',
    'secretManager.jwtKey': '订阅密钥',
    'secretManager.apiKey': '密钥',
    'secretManager.keySaved': 'MiniMax {0}已保存。',

    // config
    'config.invalidApiHost': 'MiniMax API 地址必须是有效的 URL。',
    'config.apiHostExtraComponents': 'MiniMax API 地址不能包含用户名、密码、查询参数或片段。',
    'config.apiHostNotSecure': 'MiniMax API 地址必须使用 HTTPS；本地回环调试地址可使用 HTTP。',

    // speakTextTool
    'speakTextTool.characters': '{0} 个字符',
    'speakTextTool.voiceLabel': '音色 `{0}`',
    'speakTextTool.modelLabel': '模型 `{0}`',
    'speakTextTool.providedText': '提供的文本',
    'speakTextTool.invocationMessage': '正在生成 MiniMax 语音',
    'speakTextTool.confirmationTitle': '使用 MiniMax 文字转语音播放文本',
    'speakTextTool.confirmationMessage': '要为{0}生成并播放 MiniMax 语音吗？这会消耗 MiniMax 额度或账户余额。',
    'speakTextTool.emptyText': 'text 参数必须是非空字符串。',
    'speakTextTool.cacheHit': ' 已复用缓存音频。',
    'speakTextTool.result': '正在使用 MiniMax 文字转语音播放 {0} 个字符。{1}',

    // multiRoleTtsService
    'multiRoleTts.noSegments': '没有可合成的文本片段。',

    // voiceConfigFile
    'voiceConfig.invalidJson': '语音配置文件 {0} 不是有效的 JSON，已忽略。',
    'voiceConfig.invalidFormat': '语音配置文件 {0} 格式不正确，应为 JSON 对象。'
};

const en: MessageBundle = {
    'tts.emptyText': 'No text to speak.',
    'tts.textTooLong': 'MiniMax TTS supports up to {0} characters per request. Please select shorter text.',

    'minimax.emptyAudio': 'MiniMax returned empty audio data.',
    'minimax.invalidAudioHex': 'MiniMax returned invalid hex-encoded audio data.',
    'minimax.requestCancelled': 'MiniMax TTS request was cancelled.',
    'minimax.httpError': 'MiniMax TTS request failed with HTTP status {0}.',
    'minimax.requestFailed': 'MiniMax TTS request failed.',
    'minimax.noAudioData': 'MiniMax TTS response contained no audio data.',
    'minimax.timeout': 'MiniMax TTS request timed out after {0} seconds.',
    'minimax.emptyResponseBody': 'Empty response body',
    'minimax.traceId': 'Trace ID: {0}',

    'player.serverStartFailed': 'Failed to start local player server.',
    'player.pauseInfo': 'External player is open. Use the player window to pause or resume playback.',
    'player.resumeInfo': 'Playback resumed.',
    'player.stopInfo': 'External player is open. Use the player window to stop playback.',
    'player.openFailed': 'Failed to open external player page.',
    'player.noBrowser': 'Failed to open external player page. Please make sure Safari, Chrome, Edge, or another browser is installed.',

    'errors.missingApiKey': 'MiniMax API key is not set. Run "MiniMax TTS: Set API Key" first.',
    'errors.unknown': 'An unknown MiniMax TTS error occurred.',

    'roleAnalysis.apiError': 'Role analysis API returned an error ({0}): {1}',
    'roleAnalysis.emptyContent': 'Role analysis API returned no content.',
    'roleAnalysis.missingApiKey': 'Role analysis API key is not set. Run "MiniMax TTS: Set Role Analysis API Key" first.',

    'roleAnalysis.noText': 'No text to analyze.',
    'roleAnalysis.invalidJson': 'Language model did not return a valid JSON array.',
    'roleAnalysis.parseError': 'Failed to parse the language model JSON response.',
    'roleAnalysis.notArray': 'Language model did not return a JSON array.',
    'roleAnalysis.emptyResult': 'Language model returned an empty role analysis result.',
    'roleAnalysis.noValidResult': 'Language model did not return a valid role analysis result.',

    'extension.noEditor': 'Open an editor and select text to speak first.',
    'extension.noSelection': 'Select text to speak first.',
    'extension.speakProgress': 'Generating MiniMax speech',
    'extension.speakInputTitle': 'MiniMax TTS: Speak Input Text',
    'extension.speakInputPrompt': 'Enter text to convert to speech.',
    'extension.textEmpty': 'Text cannot be empty.',
    'extension.noEditorForRoles': 'Open an editor containing novel text first.',
    'extension.noText': 'No text to speak.',
    'extension.roleAnalysisProgress': 'Analyzing characters with {0}',
    'extension.roleAnalysisChunk': 'Analyzed {0}/{1} chunks',
    'extension.synthesizeProgress': 'Generating MiniMax multi-voice speech',
    'extension.synthesizeComplete': 'MiniMax multi-voice: generated {0} audio segments, {1} characters total.',
    'extension.startSynthesis': '$(check) Start Synthesis',
    'extension.roleSummary': '{0} characters, ~{1} chars, will consume MiniMax quota',
    'extension.voiceIdLabel': 'Voice {0}{1}',
    'extension.dirConfigLabel': ' · directory config',
    'extension.voiceTypeLabel': 'Type: {0}',
    'extension.confirmRolesTitle': 'Confirm Characters & Voices',
    'extension.confirmRolesPlaceholder': 'Select a character to change voice; choose "Start Synthesis" when ready.',
    'extension.modifyVoiceTitle': 'Change voice for "{0}"',
    'extension.modifyVoicePrompt': 'Enter MiniMax voice ID.',
    'extension.voiceIdEmpty': 'Voice ID cannot be empty.',
    'extension.cacheHit': 'cached',
    'extension.cacheMiss': 'new',
    'extension.speakComplete': 'MiniMax TTS: opened {0} characters in external player ({1})',
    'extension.setKey': 'Set Key',
    'extension.apiEndpointTitle': 'API Endpoint',
    'extension.cannotBeEmpty': 'Cannot be empty.',
    'extension.modelNameTitle': 'Model Name',
    'extension.keepExistingKey': 'Leave blank to keep existing key',
    'extension.roleAnalysisConfigured': 'Role analysis: {0} @ {1}',
    'extension.setSoundEffectsDirTitle': 'Select Sound Effects Library Folder',
    'extension.soundEffectsDirSet': 'Sound effects library set to: {0}',

    'secretManager.setKeyTitle': 'Set MiniMax API Key',
    'secretManager.setKeyPrompt': 'Paste your MiniMax API key. For Audio Subscription, use the API Platform key from "Account > API Keys". For Token Plan/Credits, use the Subscription Key from "Billing > Token Plan".',
    'secretManager.keyEmpty': 'MiniMax API key cannot be empty.',
    'secretManager.jwtKey': 'Subscription Key',
    'secretManager.apiKey': 'API Key',
    'secretManager.keySaved': 'MiniMax {0} saved.',

    'config.invalidApiHost': 'MiniMax API host must be a valid URL.',
    'config.apiHostExtraComponents': 'MiniMax API host must not contain username, password, query parameters or fragment.',
    'config.apiHostNotSecure': 'MiniMax API host must use HTTPS; HTTP is allowed only for localhost debugging.',

    'speakTextTool.characters': '{0} characters',
    'speakTextTool.voiceLabel': 'voice `{0}`',
    'speakTextTool.modelLabel': 'model `{0}`',
    'speakTextTool.providedText': 'the provided text',
    'speakTextTool.invocationMessage': 'Generating MiniMax speech',
    'speakTextTool.confirmationTitle': 'Use MiniMax TTS to Speak Text',
    'speakTextTool.confirmationMessage': 'Generate and play MiniMax speech for {0}? This will consume MiniMax quota or account balance.',
    'speakTextTool.emptyText': 'The text parameter must be a non-empty string.',
    'speakTextTool.cacheHit': ' Reused cached audio.',
    'speakTextTool.result': 'Playing {0} characters using MiniMax TTS.{1}',

    'multiRoleTts.noSegments': 'No text segments to synthesize.',

    'voiceConfig.invalidJson': 'Voice config file {0} is not valid JSON and was ignored.',
    'voiceConfig.invalidFormat': 'Voice config file {0} has an invalid format; expected a JSON object.'
};

const bundles: Readonly<Record<string, MessageBundle>> = {
    'zh-cn': zhCn,
    en
};

export function t(key: string, ...args: (string | number)[]): string {
    const lang = vscode.env.language;
    const bundle = bundles[lang] ?? bundles['en'];
    let msg = bundle?.[key] ?? bundles['en']?.[key] ?? key;
    for (let i = 0; i < args.length; i++) {
        msg = msg.replace(`{${i}}`, String(args[i]));
    }
    return msg;
}
