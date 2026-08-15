# x-audio 朗读助手 — VS Code 扩展

通过可插拔 TTS 渠道（默认 MiniMax）合成语音的 VS Code 扩展。提供命令和 Language Model Tool（`xaudio_speak`）供 Copilot 集成使用。

## 构建与测试

- **编译**：`npm run compile` — TypeScript → CommonJS，`rootDir: src`，输出到 `out/`（入口 `./out/extension.js`）
- **代码检查**：`npm run lint` — ESLint 检查 `src/`
- **测试**：使用自定义轻量运行器，非 Mocha。测试位于 `src/test/`（标准布局），通过 VS Code 的 "Extension Tests" 启动配置运行，或 `npm test`（即 `node ./out/test/runTest.js`）。依赖 `@vscode/test-electron`。
- **打包**：`npm run package` — `vsce package`，发布前自动执行 `vscode:prepublish`（lint + compile）

## 架构

```
extension.ts            — 入口（activate/deactivate），注册命令与 LM tool，装配当前渠道
  ├── common/            — 通用基础模块
  │   ├── config.ts      — 通用 VS Code 设置（`xaudio.*`）、默认值
  │   ├── i18n.ts        — 国际化消息定义（简体中文/英文）
  │   ├── apiKey.ts      — 通用 API 密钥规范化
  │   ├── errors.ts      — 自定义错误类
  │   ├── types.ts       — AudioFormat + TtsSynthesizer 抽象接口
  │   ├── fileUtils.ts   — 文件工具
  │   └── utils.ts       — 通用工具函数
  ├── providers/
  │   ├── types.ts       — TtsProvider 渠道抽象接口
  │   ├── registry.ts    — 渠道注册表，按 `xaudio.provider` 选择当前渠道
  │   ├── shared.ts      — 渠道共用的配置读取与 fetch 错误转换
  │   ├── minimax/       — MiniMax 渠道（默认）：config/client/apiKey/index
  │   └── doubao/        — 豆包音频生成（Seed-Audio 1.0，非流式 HTTP + URL 下载）：config/client/apiKey/index。
  │                       ⚠️ 未注册到 registry，仅由豆包音频场景命令/工具使用
  ├── services/          — 业务服务层
  │   ├── ttsService.ts      — 编排合成流程 + 文件缓存（只依赖 TtsSynthesizer 接口）
  │   ├── secretManager.ts   — SecretStorage 中的 API 密钥（按渠道命名空间）
  │   ├── doubaoScene.ts     — 豆包音频场景服务（与普通朗读完全隔离：单条 Prompt 生成综合场景）
  │   ├── multiRoleTtsService.ts — 分角色多段合成编排
  │   └── voiceConfigFile.ts — `.ttsvoices.json` 配置文件读写
  ├── roles/             — 角色分析与音色分配
  │   ├── roleAnalysisClient.ts — OpenAI 兼容 API 客户端（DeepSeek 等），用于角色分析
  │   ├── roleAnalyzer.ts    — 使用 Copilot 语言模型（vscode.lm）或外部 API 分析小说角色与对白
  │   ├── roleAnalyzerPrompts.ts — 角色分析提示词与音色类型定义
  │   ├── roleVoiceMapper.ts — 角色 → 音色 ID 映射（workspaceState 持久化角色覆盖）
  │   └── roleConfirmation.ts — 角色确认 QuickPick 交互界面
  ├── commands/          — 命令流程编排
  │   ├── roleSpeechFlow.ts — 分角色朗读流程
  │   └── roleAnalysisConfigFlow.ts — 角色分析配置向导
  ├── tools/             — Language Model Tool
  │   ├── speakTextTool.ts   — `xaudio_speak` vscode.LanguageModelTool 实现
  │   └── scenePromptTool.ts — `xaudio_scene` vscode.LanguageModelTool 实现（供智能体调用）
  └── player/            — 播放层
      ├── externalAudioPlayer.ts — 外部 Chromium 浏览器音频播放
      └── playerPage.ts      — 播放器 Webview HTML 页面生成
  └── test/              — 测试（标准扩展布局）
      ├── runTest.ts     — 测试启动器（@vscode/test-electron CLI 方式）
      └── suite/         — 测试用例与自定义运行器（index.ts 注册全局 suite/test）
```

## 渠道（Provider）扩展方式

新增 TTS 渠道时：

1. 在 `src/providers/<id>/` 下实现：
   - `config.ts` — 渠道专属配置读取（`xaudio.<id>.*`）
   - `client.ts` — 实现 `TtsSynthesizer` 接口
   - `apiKey.ts`（可选）— 密钥检测逻辑
   - `index.ts` — 导出 `TtsProvider` 对象
2. 在 `src/providers/registry.ts` 中注册
3. 在 `package.json` 的 `xaudio.provider` enum 中加入新渠道 ID

## 关键约定

- **严格 TypeScript**：启用了 `noUnusedLocals`、`noUnusedParameters`（未使用参数以 `_` 前缀标记）、`noImplicitReturns` 等。详见 [tsconfig.json](tsconfig.json)。
- **模块系统**：CommonJS（`module: "CommonJS"`）。使用 `import`/`export` 语法编写，输出为 CJS。
- **VS Code 目标版本**：`^1.100.0`。使用了 `vscode.lm.registerTool`（Language Model Tool API）、`vscode.SecretStorage`、`vscode.WebviewPanel`。
- **用户界面文本**使用简体中文。
- **扩展实例间不共享状态** — 每次 activate 创建全新的服务实例。
- **音频缓存**：合成的音频文件按内容哈希缓存在 `globalStorageUri/audio-cache/`。缓存由 `xaudio.cacheEnabled` 设置控制。

## 注意事项

- 测试文件手动将 `suite`/`test` 注册为全局变量（无测试框架）。不要添加 Mocha/Jest 依赖。
- `.vscodeignore` 排除了 `src/`（含测试）与 `scripts/` — 运行时代码位于 `out/`。
- 扩展使用 `extensionKind: "ui"` — 只能在本地扩展宿主中运行。
- `externalAudioPlayer.ts` 会启动外部 Chromium 浏览器并附带 `--autoplay-policy=no-user-gesture-required` 来播放音频。
