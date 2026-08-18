# Change Log

All notable changes to the "x-audio" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### 新增

- 新增程序化朗读入口命令 `xaudio.speakText`：其他扩展（如 X Reader）可传入 `text`、`mode`（`plain` / `roles`）、`documentUri` 与 `voiceConfig` 直接调用朗读，长文本自动分块合成并顺序播放。
- `roles` 模式支持调用方通过 `voiceConfig` 参数直接提供角色音色配置（角色名 → 音色 ID、角色类型 → 音色 ID、语音参数），优先于目录 `.ttsvoices.json` 查找。
- 支持角色卡音色约定：按文档目录向上查找角色卡目录（`角色卡`），从卡片首行 `# 角色名` 与 `- 音色：xxx`（或 frontmatter `voice` / `voiceId`）解析角色音色，与 X Reader 联动时分角色朗读自动生效。

### 优化

- 重写市场说明文档：更规范的结构、完整的命令与设置说明、联动协议文档。

## [1.0.4]

- 按标准 VS Code 扩展布局统一构建、测试与代码检查流程（esbuild + @vscode/test-cli）。
- 全新市场说明文档：更直观的特性展示、快速开始与常见问题。
- 请求重试、播放器资源回收与并发控制收敛。

## [1.0.3]

- 新增豆包音频场景生成（Seed-Audio）：整段 Prompt 端到端生成多角色对白、音效与背景音乐。
- 移除背景音效素材库功能。

## [1.0.0]

- 扩展更名 audioplugin-tts 为 x-audio，命令、配置与智能体工具统一 xaudio 前缀。
- 场景音效播放增加提示消息。

