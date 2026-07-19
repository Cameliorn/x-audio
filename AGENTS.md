# MiniMax TTS — VS Code 扩展

通过 MiniMax API 合成语音的 VS Code 扩展。提供命令和 Language Model Tool（`minimax_tts_speak`）供 Copilot 集成使用。

## 构建与测试

- **编译**：`npm run compile` — TypeScript → CommonJS，输出到 `out/`
- **代码检查**：`npx eslint src test`
- **测试**：使用自定义轻量运行器，非 Mocha。通过 VS Code 的 "Extension Tests" 启动配置运行，或 `node ./out/test/runTest.js`。依赖 `@vscode/test-electron`。

## 架构

```
extension.ts          — 入口（activate/deactivate），注册命令与 LM tool
  ├── config.ts        — VS Code 设置（`minimaxTts.*`）、默认值、规范化
  ├── secretManager.ts — SecretStorage 中的 API 密钥（vscode.SecretStorage）
  ├── minimaxClient.ts — MiniMax TTS API HTTP 客户端（基于 fetch）
  ├── ttsService.ts    — 编排合成流程 + 文件缓存
  ├── roleAnalyzer.ts  — 使用 Copilot 语言模型（vscode.lm）分析小说角色与对白
  ├── roleVoiceMapper.ts — 角色 → 音色 ID 映射（workspaceState 持久化角色覆盖）
  ├── multiRoleTtsService.ts — 分角色多段合成编排
  ├── speakTextTool.ts — vscode.LanguageModelTool 实现
  ├── externalAudioPlayer.ts — 外部 Chromium 浏览器音频播放
  ├── apiKey.ts        — JWT/API 密钥规范化与检测
  ├── errors.ts        — 自定义错误类
  └── types.ts         — 类型重导出 + MiniMaxSynthesizer 接口
```

## 关键约定

- **严格 TypeScript**：启用了 `noUnusedLocals`、`noUnusedParameters`（未使用参数以 `_` 前缀标记）、`noImplicitReturns` 等。详见 [tsconfig.json](tsconfig.json)。
- **模块系统**：CommonJS（`module: "CommonJS"`）。使用 `import`/`export` 语法编写，输出为 CJS。
- **VS Code 目标版本**：`^1.100.0`。使用了 `vscode.lm.registerTool`（Language Model Tool API）、`vscode.SecretStorage`、`vscode.WebviewPanel`。
- **用户界面文本**使用简体中文。
- **扩展实例间不共享状态** — 每次 activate 创建全新的服务实例。
- **音频缓存**：合成的音频文件按内容哈希缓存在 `globalStorageUri/audio-cache/`。缓存由 `minimaxTts.cacheEnabled` 设置控制。

## 注意事项

- 测试文件手动将 `suite`/`test` 注册为全局变量（无测试框架）。不要添加 Mocha/Jest 依赖。
- `.vscodeignore` 排除了 `src/` 和 `test/` 目录 — 运行时代码位于 `out/`。
- 扩展使用 `extensionKind: "ui"` — 只能在本地扩展宿主中运行。
- `externalAudioPlayer.ts` 会启动外部 Chromium 浏览器并附带 `--autoplay-policy=no-user-gesture-required` 来播放音频。
