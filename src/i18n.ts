import * as vscode from 'vscode';

type MessageBundle = Readonly<Record<string, string>>;

const zhCn: MessageBundle = {
  // ttsService
  'tts.emptyText': '没有可朗读的文本。',
  'tts.textTooLong': '文字转语音单次请求最多支持 {0} 个字符。请选择更短的文本。',

  // minimaxClient
  'minimax.emptyAudio': 'MiniMax 返回了空音频数据。',
  'minimax.invalidAudioHex': 'MiniMax 返回了无效的十六进制音频数据。',
  'minimax.httpError': '文字转语音请求失败，HTTP 状态码 {0}。',
  'minimax.requestFailed': '文字转语音请求失败。',
  'minimax.noAudioData': '文字转语音响应中没有音频数据。',
  'minimax.timeout': '文字转语音请求在 {0} 秒后超时。',
  'minimax.emptyResponseBody': '响应体为空',
  'minimax.traceId': '追踪 ID: {0}',

  // doubaoClient
  'doubao.httpError': '文字转语音请求失败，HTTP 状态码 {0}。',
  'doubao.requestFailed': '豆包音频生成请求失败。',
  'doubao.noAudioUrl': '豆包响应中没有音频下载地址。',
  'doubao.emptyAudio': '豆包返回了空音频数据。',
  'doubao.timeout': '文字转语音请求在 {0} 秒后超时。',
  'doubao.emptyResponseBody': '响应体为空',
  'doubao.invalidJson': '豆包返回了无效的 JSON 响应。',
  'doubao.audioDownloadFailed': '音频下载失败，HTTP 状态码 {0}。',
  'doubao.textAuditFailed': '豆包文本审核未通过，请修改 Prompt 内容后重试。',

  // doubaoScene
  'scene.noEditor': '请先打开编辑器并选中要生成音频场景的文本。',
  'scene.noText': '音频场景 Prompt 不能为空。',
  'scene.promptTooLong': '豆包音频场景的 Prompt 最多支持 {0} 个字符，当前 {1} 个。请缩减后再试。',
  'scene.progress': '正在生成豆包音频场景',
  'scene.complete': '豆包音频场景已开始播放。',

  // scenePromptTool
  'sceneTool.characters': '{0} 个字符',
  'sceneTool.providedPrompt': '（未提供 Prompt 内容）',
  'sceneTool.invocationMessage': '正在生成豆包音频场景',
  'sceneTool.confirmationTitle': '生成豆包音频场景',
  'sceneTool.confirmationMessage': '将使用豆包音频生成模型（Seed-Audio 1.0）把以下 Prompt 合成为完整音频场景（{0}）：\n\n{1}',
  'sceneTool.result': '豆包音频场景已生成并开始播放。',

  // externalAudioPlayer
  'player.serverStartFailed': '无法启动本地播放器服务。',
  'player.pauseInfo': '播放已暂停。',
  'player.resumeInfo': '播放已恢复。',
  'player.stopInfo': '播放已停止。',
  'player.openFailed': '无法打开外部播放器页面。',
  'player.closeWindowManually': '播放器窗口是通过系统回退方式打开的，无法自动关闭，请手动关闭该窗口。',
  'player.noBrowser': '无法打开外部播放器页面。请确认系统已安装 Safari、Chrome、Edge 或其他浏览器。',
  'player.noActivePlayback': '当前没有活跃的播放，请先朗读文本。',

  // errors
  'errors.missingApiKey': '尚未设置语音合成密钥。请先运行“x-audio 朗读助手：设置密钥”。',
  'errors.unknown': '发生未知的朗读错误。',

  // roleAnalysisClient
  'roleAnalysis.apiError': '角色分析 API 返回错误 ({0})：{1}',
  'roleAnalysis.emptyContent': '角色分析 API 未返回有效内容。',
  'roleAnalysis.missingApiKey': '尚未设置角色分析 API 密钥。请先运行“x-audio 朗读助手：配置角色分析”。',
  'roleAnalysis.timeout': '角色分析请求在 {0} 秒后超时。',
  'roleAnalysis.copilotNotConfigured': '尚未在 Copilot 中选择角色分析模型。请先运行“x-audio 朗读助手：配置角色分析”。',
  'roleAnalysis.copilotModelNotFound': '角色分析模型 "{0}" 不可用，请在 Copilot 中重新选择。',
  'roleAnalysis.copilotTokenizerError': '模型「{0}」缺少 tokenizer 元数据（VS Code 的 Copilot 已知问题），无法计算 token。请重新运行“x-audio 朗读助手：配置角色分析”选择其他模型，或改用 OpenAI 兼容接口，并确保 VS Code 与 GitHub Copilot 扩展均为最新版本（当前 {1}）。',

  // roleAnalyzer
  'roleAnalysis.retryFeedback': '上次尝试的输出无法解析（{0}）。请严格按格式要求只输出 JSON 数组，修正错误后重新输出。',
  'roleAnalysis.noText': '没有可分析的文本。',
  'roleAnalysis.invalidJson': '语言模型未返回有效的 JSON 数组。',
  'roleAnalysis.parseError': '无法解析语言模型返回的 JSON。',
  'roleAnalysis.notArray': '语言模型返回的角色分析结果不是数组。',
  'roleAnalysis.emptyResult': '语言模型返回的角色分析结果为空。',
  'roleAnalysis.noValidResult': '语言模型未返回有效的角色分析结果。',

  // extension
  'extension.noEditor': '请先打开编辑器并选中要朗读的文本。',
  'extension.noSelection': '请先选中要朗读的文本。',
  'extension.speakProgress': '正在生成语音',
  'extension.noEditorForRoles': '请先打开包含小说文本的编辑器。',
  'extension.noText': '没有可朗读的文本。',
  'extension.roleAnalysisProgress': '正在使用 {0} 分析小说角色',
  'extension.roleAnalysisChunk': '已分析 {0}/{1} 段',
  'extension.synthesizeProgress': '正在生成多角色语音',
  'extension.synthesizeComplete': '多角色朗读：已生成 {0} 个音频片段，共 {1} 字。',
  'extension.startSynthesis': '$(check) 开始合成语音',
  'extension.roleSummary': '{0} 名角色，约 {1} 字，将消耗语音合成额度',
  'extension.voiceIdLabel': '音色 {0}{1}',
  'extension.dirConfigLabel': ' · 目录配置',
  'extension.voiceTypeLabel': '类型：{0}',
  'extension.confirmRolesTitle': '确认小说角色与音色',
  'extension.confirmRolesPlaceholder': '选择角色可修改音色；确认无误后选择“开始合成语音”。',
  'extension.modifyVoiceTitle': '修改「{0}」的音色',
  'extension.modifyVoicePrompt': '输入音色 ID。',
  'extension.voiceIdEmpty': '音色 ID 不能为空。',
  'extension.cacheHit': '缓存',
  'extension.cacheMiss': '新生成',
  'extension.speakComplete': 'x-audio 朗读助手：已在外部播放器打开 {0} 个字符（{1}）',
  'extension.setKey': '设置密钥',
  'extension.apiEndpointTitle': 'API 地址',
  'extension.cannotBeEmpty': '不能为空。',
  'extension.modelNameTitle': '模型名',
  'extension.keepExistingKey': '留空则保留现有密钥',
  'extension.roleAnalysisConfigured': '角色分析：{0} @ {1}',
  'extension.roleAnalysisProviderTitle': '选择角色分析 AI 来源',
  'extension.roleAnalysisProviderCopilot': 'Copilot 内置模型',
  'extension.roleAnalysisProviderCopilotDesc': '使用 VS Code Copilot 中已配置的任意模型',
  'extension.roleAnalysisProviderOpenai': 'OpenAI 兼容接口',
  'extension.roleAnalysisProviderOpenaiDesc': '使用自己的 API 密钥连接第三方服务（如 DeepSeek）',
  'extension.roleAnalysisNoCopilotModels': '当前 Copilot 中没有可用的语言模型。',
  'extension.roleAnalysisCopilotModelTitle': '选择角色分析模型',
  'extension.roleAnalysisCopilotModelPlaceholder': '从 Copilot 可用模型中选择',
  'extension.roleAnalysisCopilotConfigured': '角色分析模型：{0}（{1}）',
  'extension.previewVoiceTitle': '试听音色「{0}」',
  'extension.previewVoiceProgress': '正在生成试听片段',
  'extension.previewVoiceConfirm': '$(check) 确认修改',
  'extension.previewVoiceTest': '$(unmute) 试听此音色',
  'extension.statusPlaying': '$(unmute) 朗读中',
  'extension.statusPaused': '$(debug-pause) 已暂停',
  'extension.playbackControlsTitle': 'x-audio 播放控制',
  'extension.pauseResumeItem': '$(debug-pause) 暂停 / 恢复播放',
  'extension.stopItem': '$(debug-stop) 停止播放',
  'extension.firstRunNoApiKey': 'x-audio 朗读助手：尚未设置语音合成密钥，是否现在设置？',
  'extension.setKeySelectTitle': '选择要设置密钥的服务',
  'extension.setKeyNormalReading': '普通朗读与分角色朗读',
  'extension.setKeyDoubaoScene': '豆包音频场景生成',

  // secretManager
  'secretManager.setKeyTitle': '设置 {0} 密钥',
  'secretManager.setKeyPrompt': '粘贴 {0} 语音合成密钥。',
  'secretManager.setKeyPromptMiniMax': '粘贴 MiniMax 语音合成密钥。',
  'secretManager.setKeyPromptDoubao': '粘贴火山引擎语音 API Key。',
  'secretManager.keyEmpty': '密钥不能为空。',
  'secretManager.jwtKey': '订阅密钥',
  'secretManager.apiKey': '密钥',
  'secretManager.keySaved': '{0}已保存。',

  // config
  'config.invalidApiHost': 'API 地址必须是有效的 URL。',
  'config.apiHostExtraComponents': 'API 地址不能包含用户名、密码、查询参数或片段。',
  'config.apiHostNotSecure': 'API 地址必须使用 HTTPS；本地回环调试地址可使用 HTTP。',

  // speakTextTool
  'speakTextTool.characters': '{0} 个字符',
  'speakTextTool.voiceLabel': '音色 `{0}`',
  'speakTextTool.modelLabel': '模型 `{0}`',
  'speakTextTool.providedText': '提供的文本',
  'speakTextTool.invocationMessage': '正在生成语音',
  'speakTextTool.confirmationTitle': '使用 x-audio 朗读助手播放文本',
  'speakTextTool.confirmationMessage': '要为{0}生成并播放语音吗？这会消耗语音合成额度或账户余额。',
  'speakTextTool.emptyText': 'text 参数必须是非空字符串。',
  'speakTextTool.cacheHit': ' 已复用缓存音频。',
  'speakTextTool.result': '正在使用 x-audio 朗读助手播放 {0} 个字符。{1}',

  // multiRoleTtsService
  'multiRoleTts.noSegments': '没有可合成的文本片段。',

  // voiceConfigFile
  'voiceConfig.invalidJson': '语音配置文件 {0} 不是有效的 JSON，已忽略。（路径：{1}）',
  'voiceConfig.invalidFormat': '语音配置文件 {0} 格式不正确，应为 JSON 对象。（路径：{1}）'
};

const en: MessageBundle = {
  'tts.emptyText': 'No text to speak.',
  'tts.textTooLong': 'TTS supports up to {0} characters per request. Please select shorter text.',

  'minimax.emptyAudio': 'MiniMax returned empty audio data.',
  'minimax.invalidAudioHex': 'MiniMax returned invalid hex-encoded audio data.',
  'minimax.httpError': 'TTS request failed with HTTP status {0}.',
  'minimax.requestFailed': 'TTS request failed.',
  'minimax.noAudioData': 'TTS response contained no audio data.',
  'minimax.timeout': 'TTS request timed out after {0} seconds.',
  'minimax.emptyResponseBody': 'Empty response body',
  'minimax.traceId': 'Trace ID: {0}',

  // doubaoClient
  'doubao.httpError': 'TTS request failed with HTTP status {0}.',
  'doubao.requestFailed': 'Doubao audio generation request failed.',
  'doubao.noAudioUrl': 'Doubao response contained no audio URL.',
  'doubao.emptyAudio': 'Doubao returned empty audio data.',
  'doubao.timeout': 'TTS request timed out after {0} seconds.',
  'doubao.emptyResponseBody': 'Empty response body',
  'doubao.invalidJson': 'Doubao returned an invalid JSON response.',
  'doubao.audioDownloadFailed': 'Audio download failed with HTTP status {0}.',
  'doubao.textAuditFailed': 'Doubao text audit failed. Please revise the prompt and retry.',

  // doubaoScene
  'scene.noEditor': 'Open an editor and select the text to generate an audio scene from.',
  'scene.noText': 'The audio scene prompt cannot be empty.',
  'scene.promptTooLong': 'Doubao audio scene prompts support at most {0} characters, currently {1}. Please shorten it.',
  'scene.progress': 'Generating Doubao audio scene',
  'scene.complete': 'Doubao audio scene playback started.',

  // scenePromptTool
  'sceneTool.characters': '{0} characters',
  'sceneTool.providedPrompt': '(no prompt content provided)',
  'sceneTool.invocationMessage': 'Generating Doubao audio scene',
  'sceneTool.confirmationTitle': 'Generate Doubao audio scene',
  'sceneTool.confirmationMessage': 'The following prompt will be synthesized into a full audio scene with the Doubao audio generation model (Seed-Audio 1.0) ({0}):\n\n{1}',
  'sceneTool.result': 'Doubao audio scene generated and playback started.',

  'player.serverStartFailed': 'Failed to start local player server.',
  'player.pauseInfo': 'Playback paused.',
  'player.resumeInfo': 'Playback resumed.',
  'player.stopInfo': 'Playback stopped.',
  'player.openFailed': 'Failed to open external player page.',
  'player.closeWindowManually': 'The player window was opened via a system fallback and cannot be closed automatically. Please close it manually.',
  'player.noBrowser': 'Failed to open external player page. Please make sure Safari, Chrome, Edge, or another browser is installed.',
  'player.noActivePlayback': 'No active playback. Please speak some text first.',

  'errors.missingApiKey': 'TTS API key is not set. Run "x-audio Reader: Set API Key" first.',
  'errors.unknown': 'An unknown reading error occurred.',

  'roleAnalysis.apiError': 'Role analysis API returned an error ({0}): {1}',
  'roleAnalysis.emptyContent': 'Role analysis API returned no content.',
  'roleAnalysis.missingApiKey': 'Role analysis API key is not set. Run "x-audio Reader: Configure Role Analysis" first.',
  'roleAnalysis.timeout': 'Role analysis request timed out after {0} seconds.',
  'roleAnalysis.copilotNotConfigured': 'No Copilot model selected for role analysis. Run "x-audio Reader: Configure Role Analysis" first.',
  'roleAnalysis.copilotModelNotFound': 'Role analysis model "{0}" is not available. Please re-select it in Copilot.',
  'roleAnalysis.copilotTokenizerError': 'Model "{0}" is missing tokenizer metadata (a known Copilot issue in VS Code) and cannot compute tokens. Re-run "x-audio Reader: Configure Role Analysis" to pick another model, or use the OpenAI-compatible provider instead, and make sure VS Code and the GitHub Copilot extension are up to date (current {1}).',

  'roleAnalysis.retryFeedback': 'The previous output could not be parsed ({0}). Output only a JSON array exactly matching the required format, then try again.',
  'roleAnalysis.noText': 'No text to analyze.',
  'roleAnalysis.invalidJson': 'Language model did not return a valid JSON array.',
  'roleAnalysis.parseError': 'Failed to parse the language model JSON response.',
  'roleAnalysis.notArray': 'Language model did not return a JSON array.',
  'roleAnalysis.emptyResult': 'Language model returned an empty role analysis result.',
  'roleAnalysis.noValidResult': 'Language model did not return a valid role analysis result.',

  'extension.noEditor': 'Open an editor and select text to speak first.',
  'extension.noSelection': 'Select text to speak first.',
  'extension.speakProgress': 'Generating speech',
  'extension.noEditorForRoles': 'Open an editor containing novel text first.',
  'extension.noText': 'No text to speak.',
  'extension.roleAnalysisProgress': 'Analyzing characters with {0}',
  'extension.roleAnalysisChunk': 'Analyzed {0}/{1} chunks',
  'extension.synthesizeProgress': 'Generating multi-voice speech',
  'extension.synthesizeComplete': 'Multi-voice reading: generated {0} audio segments, {1} characters total.',
  'extension.startSynthesis': '$(check) Start Synthesis',
  'extension.roleSummary': '{0} characters, ~{1} chars, will consume TTS quota',
  'extension.dirConfigLabel': ' · directory config',
  'extension.voiceTypeLabel': 'Type: {0}',
  'extension.confirmRolesTitle': 'Confirm Characters & Voices',
  'extension.confirmRolesPlaceholder': 'Select a character to change voice; choose "Start Synthesis" when ready.',
  'extension.modifyVoiceTitle': 'Change voice for "{0}"',
  'extension.modifyVoicePrompt': 'Enter voice ID.',
  'extension.voiceIdEmpty': 'Voice ID cannot be empty.',
  'extension.cacheHit': 'cached',
  'extension.cacheMiss': 'new',
  'extension.speakComplete': 'x-audio Reader: opened {0} characters in external player ({1})',
  'extension.setKey': 'Set Key',
  'extension.apiEndpointTitle': 'API Endpoint',
  'extension.cannotBeEmpty': 'Cannot be empty.',
  'extension.modelNameTitle': 'Model Name',
  'extension.keepExistingKey': 'Leave blank to keep existing key',
  'extension.roleAnalysisConfigured': 'Role analysis: {0} @ {1}',
  'extension.roleAnalysisProviderTitle': 'Select Role Analysis AI Source',
  'extension.roleAnalysisProviderCopilot': 'Copilot Models',
  'extension.roleAnalysisProviderCopilotDesc': 'Use any model configured in VS Code Copilot',
  'extension.roleAnalysisProviderOpenai': 'OpenAI-compatible API',
  'extension.roleAnalysisProviderOpenaiDesc': 'Use your own API key to connect to third-party services (e.g. DeepSeek)',
  'extension.roleAnalysisNoCopilotModels': 'No language models available in Copilot.',
  'extension.roleAnalysisCopilotModelTitle': 'Select Role Analysis Model',
  'extension.roleAnalysisCopilotModelPlaceholder': 'Choose from available Copilot models',
  'extension.roleAnalysisCopilotConfigured': 'Role analysis model: {0} ({1})',
  'extension.previewVoiceProgress': 'Generating preview clip',
  'extension.previewVoiceConfirm': '$(check) Confirm',
  'extension.previewVoiceTest': '$(unmute) Preview this voice',
  'extension.statusPlaying': '$(unmute) Speaking',
  'extension.statusPaused': '$(debug-pause) Paused',
  'extension.playbackControlsTitle': 'x-audio Playback Controls',
  'extension.pauseResumeItem': '$(debug-pause) Pause / Resume',
  'extension.stopItem': '$(debug-stop) Stop Playback',
  'extension.firstRunNoApiKey': 'x-audio Reader: TTS API key is not set yet. Set it now?',
  'extension.setKeySelectTitle': 'Select a service to set the API key for',
  'extension.setKeyNormalReading': 'Normal & multi-role reading',
  'extension.setKeyDoubaoScene': 'Doubao audio scene generation',

  'secretManager.setKeyTitle': 'Set {0} API Key',
  'secretManager.setKeyPrompt': 'Paste your {0} API key.',
  'secretManager.setKeyPromptMiniMax': 'Paste your MiniMax API key.',
  'secretManager.setKeyPromptDoubao': 'Paste the Volcano Engine speech API key.',
  'secretManager.keyEmpty': 'API key cannot be empty.',
  'secretManager.jwtKey': 'Subscription Key',
  'secretManager.apiKey': 'API Key',
  'secretManager.keySaved': '{0} saved.',

  'config.invalidApiHost': 'API host must be a valid URL.',
  'config.apiHostExtraComponents': 'API host must not contain username, password, query parameters or fragment.',
  'config.apiHostNotSecure': 'API host must use HTTPS; HTTP is allowed only for localhost debugging.',

  'speakTextTool.characters': '{0} characters',
  'speakTextTool.voiceLabel': 'voice `{0}`',
  'speakTextTool.modelLabel': 'model `{0}`',
  'speakTextTool.providedText': 'the provided text',
  'speakTextTool.invocationMessage': 'Generating speech',
  'speakTextTool.confirmationTitle': 'Use x-audio Reader to Speak Text',
  'speakTextTool.confirmationMessage': 'Generate and play speech for {0}? This will consume TTS quota or account balance.',
  'speakTextTool.emptyText': 'The text parameter must be a non-empty string.',
  'speakTextTool.cacheHit': ' Reused cached audio.',
  'speakTextTool.result': 'Playing {0} characters using x-audio Reader.{1}',

  'multiRoleTts.noSegments': 'No text segments to synthesize.',

  'voiceConfig.invalidJson': 'Voice config file {0} is not valid JSON and was ignored. (Path: {1})',
  'voiceConfig.invalidFormat': 'Voice config file {0} has an invalid format; expected a JSON object. (Path: {1})'
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
