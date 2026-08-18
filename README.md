# 🎧 x-audio 朗读助手

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/cameliorn.x-audio?color=4ec1ff&label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=cameliorn.x-audio)
[![Installs](https://img.shields.io/visual-studio-marketplace/d/cameliorn.x-audio?color=00b894&label=Downloads)](https://marketplace.visualstudio.com/items?itemName=cameliorn.x-audio)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/cameliorn.x-audio?color=fdcb6e&label=Rating)](https://marketplace.visualstudio.com/items?itemName=cameliorn.x-audio)
[![License](https://img.shields.io/github/license/Cameliorn/x-audio?color=6c5ce7)](https://github.com/Cameliorn/x-audio/blob/main/LICENSE)

> 在 VS Code 中朗读选中文本、分角色朗读小说、生成豆包音频场景，并为 Copilot Agent 提供朗读工具。

**x-audio 朗读助手** 是一款采用**可插拔 TTS 渠道**架构的语音朗读扩展：

- 🎙️ **普通朗读** — 默认使用 **MiniMax** 高保真语音合成，选中即读
- 👥 **分角色朗读** — 由 LLM 自动识别小说角色与对白，为每个角色分配专属音色
- 🎬 **豆包音频场景** — 通过 **Seed-Audio 1.0** 端到端生成多角色对白 + 音效 + 背景音乐
- 🤖 **Copilot 集成** — 注册为 Language Model Tool（`xaudio_speak` / `xaudio_scene`），让 Agent 直接开口朗读

---

## 功能特性

| | 说明 |
|---|---|
| 🎙️ **朗读选中文本** | 编辑器右键「朗读选中文本」，一键合成并播放 |
| 👥 **分角色朗读** | 自动分析角色、情绪与对白，逐角色分配不同音色 |
| 🎬 **豆包音频场景** | 整段文本作为一条 Prompt，端到端生成综合音频场景 |
| 🤖 **Copilot 工具** | 提供 `xaudio_speak`（朗读）与 `xaudio_scene`（音频场景）语言模型工具 |
| ⏯️ **播放控制** | 暂停 / 恢复、停止播放，随点随停 |
| ⚡ **音频缓存** | 相同文本与参数自动复用合成结果，省额度、少等待 |
| 🎚️ **精细调音** | 语速、音调、音量、变声与音效均可按需配置 |

## 快速开始

1. **安装扩展**，打开命令面板（`Ctrl+Shift+P`）
2. 运行命令 **「x-audio 朗读助手：设置密钥」**，粘贴你的 [MiniMax](https://platform.minimaxi.com) API 密钥（需语音订阅或 Token Plan）
3. 在编辑器中**选中文本**，右键点击 **「朗读选中文本」** 🎉

> 💡 密钥通过 VS Code `SecretStorage` 加密保存，仅存于本机；MiniMax 与豆包密钥相互独立存储。

## 使用教程

### 普通朗读

- 选中文本 → 右键 → **朗读选中文本**
- 默认音色、语速、音调等可在设置中调整（见下文「设置」）

### 分角色朗读（小说 / 对白）

1. 运行 **「x-audio 朗读助手：配置角色分析」**，选择角色分析 AI（Copilot 内置模型或 OpenAI 兼容接口，如 DeepSeek）
2. 打开小说文本，运行 **「分角色朗读选中文本」**
3. 在角色确认面板中核对角色与音色分配，确认后开始合成

> 可通过项目根目录的 `.ttsvoices.json` 为角色固定音色，让每次朗读都稳定一致（见下文）。

### 豆包音频场景（Seed-Audio 1.0）

选中一段**场景描述 Prompt**，右键 → **「用豆包生成音频场景」**，单次请求端到端生成多角色对白、语气情绪、音效与背景音乐：

```text
深夜的废弃工厂，雨滴打在铁皮屋顶。男主（低沉警惕）："你听到什么声音了吗？"
女主（压低声音）："好像……有人在跟踪我们。"背景音乐悬疑紧张，弦乐渐强，
远处偶尔传来雷声。
```

- 密钥：运行 **「设置密钥」** 时选择豆包，粘贴[火山引擎语音 API Key](https://console.volcengine.com/speech/new/setting/apikeys)
- Prompt 上限 **3000 字符**，单次输出最长 **120 秒**

### 与 Copilot 一起使用

- `xaudio_speak` — 朗读工具：Agent 在用户要求「读出来 / 朗读 / 播放」时调用，使用普通朗读渠道
- `xaudio_scene` — 音频场景工具：Agent 输入 `prompt` 字段，用豆包生成并播放完整音频场景

## 命令

| 命令 | 说明 |
|---|---|
| `xaudio.speakSelection` | 朗读选中文本 |
| `xaudio.speakText` | 程序化朗读入口：供其他扩展（如 X Reader）传入文本调用，自动分块处理长文本 |
| `xaudio.speakDocumentWithRoles` | 分角色朗读选中文本 |
| `xaudio.speakScenePrompt` | 用豆包生成音频场景（选中文本为完整 Prompt） |
| `xaudio.setApiKey` | 设置当前渠道 API 密钥 |
| `xaudio.pause` | 暂停 / 恢复播放 |
| `xaudio.stop` | 停止播放 |
| `xaudio.configureRoleAnalysis` | 配置角色分析（Copilot / DeepSeek 等） |

## 与其他扩展联动（`xaudio.speakText`）

`xaudio.speakText` 是面向其他扩展的程序化朗读入口，参数：

```ts
{
  text?: string;            // 要朗读的文本；省略时回退到活动编辑器选中内容
  mode?: 'plain' | 'roles'; // plain：普通朗读（默认）；roles：分角色朗读
  documentUri?: vscode.Uri; // 用于查找目录音色配置的文档 URI（仅 roles 模式使用）
  voiceConfig?: {           // 调用方直接提供的音色配置，优先于目录 `.ttsvoices.json`（仅 roles 模式使用）
    characterVoices: Record<string, string>;   // 角色名 → 音色 ID
    roleTypeVoices: Partial<Record<string, string>>; // 角色类型 → 音色 ID
    voiceParams: Record<string, unknown>;      // 语音参数覆盖（可为空对象）
  };
}
```

- 长文本（超过 `xaudio.maxTextLength`，默认 10000 字符）会自动按段落分块合成并顺序播放，无需调用方自行切分。
- `roles` 模式会执行完整的角色分析 → 音色确认 → 分角色合成流程；未提供 `voiceConfig` 时，`documentUri` 用于向上查找 `.ttsvoices.json`。
- 未安装 / 未激活本扩展时，调用方应自行检测（如通过 `vscode.extensions.getExtension('cameliorn.x-audio')`）并引导用户安装。

配合 **X Reader 小说阅读器**：安装 x-audio 后，X Reader 的章节页签与章节目录提供「朗读本章」「分角色朗读本章」，选中文本也可直接右键朗读。X Reader 会解析本书「角色卡」目录下的卡片（`- 音色：xxx` 指定角色音色）作为 `voiceConfig` 传入。

## 设置

通过 VS Code 设置面板调整（`xaudio.*`）。配置项按适用范围分类标注：

- **[通用]** — 所有渠道、所有朗读模式
- **[MiniMax]** — 仅 MiniMax 渠道
- **[豆包][音频场景]** — 仅豆包音频场景命令/工具
- **[分角色]** — 仅分角色朗读
- **[普通朗读]** — 仅普通朗读（朗读选中文本）

### 通用设置（`xaudio.*`）

| 设置 | 说明 | 默认值 |
|---|---|---|
| `provider` | [通用] 语音合成渠道 | `minimax` |
| `cacheEnabled` | [通用] 启用音频缓存 | `true` |
| `cacheMaxSizeMb` | [通用] 音频缓存大小上限（MB） | `512` |
| `maxTextLength` | [通用] 单次请求最大字符数 | `10000` |
| `requestTimeoutMs` | [通用] 请求超时（毫秒） | `60000` |
| `maxConcurrentRequests` | [分角色] 多角色合成最大并发请求数（1~8） | `3` |
| `browserPath` | [通用] 外部播放器浏览器路径 | — |
| `roleAnalysis.*` | [分角色] 角色分析配置（DeepSeek/Copilot） | — |

### MiniMax 渠道设置（`xaudio.minimax.*`）

| 设置 | 说明 | 默认值 |
|---|---|---|
| `apiHost` | [MiniMax] API 地址 | `https://api.minimax.io` |
| `model` | [MiniMax] 语音模型 | `speech-2.8-turbo` |
| `voiceId` | [MiniMax][普通朗读] 默认音色 ID | `English_expressive_narrator` |
| `speed` | [MiniMax] 默认语速（0.5~2.0） | `1` |
| `pitch` | [MiniMax] 默认语调偏移（-12~12） | `0` |
| `vol` | [MiniMax] 默认音量倍率（0.1~10） | `1` |
| `roleVoices` | [MiniMax][分角色] 角色类型默认音色 | — |
| `format` | [MiniMax] 输出音频格式 | `mp3` |

### 豆包音频场景设置（`xaudio.doubao.*`）

| 设置 | 说明 | 默认值 |
|---|---|---|
| `apiHost` | [豆包][音频场景] API 地址 | `https://openspeech.bytedance.com` |
| `model` | [豆包][音频场景] 音频生成模型 | `seed-audio-1.0` |
| `speechRate` | [豆包][音频场景] 语速偏移（-50~100，100 为 2.0 倍速） | `0` |
| `loudnessRate` | [豆包][音频场景] 音量偏移（格式同 speechRate） | `0` |
| `pitchRate` | [豆包][音频场景] 音调偏移（-12~12） | `0` |
| `format` | [豆包][音频场景] 输出音频格式 | `mp3` |

> 注意：音频场景为纯 Prompt 生成模式（不指定音色），Prompt 上限 3000 字符、单次输出最长 120 秒。

## 角色音色配置文件 `.ttsvoices.json`

在项目目录下创建 `.ttsvoices.json`，可为角色指定音色和语音参数（优先级高于 LLM 分析结果）：

```json
{
  "张三": { "voiceId": "male-qingse", "speed": 1.2, "pitch": 2 },
  "李四": { "speed": 0.9 },
  "王五": "male-qingse",
  "@roleVoices": {
    "narrator": { "voiceId": "audiobook_female_1", "speed": 0.9 },
    "elderly": { "pitch": -3 }
  }
}
```

- **字符串值** — 指定角色音色 ID
- **对象值** — 可同时指定 `voiceId`、`speed`（0.5~2.0）、`pitch`（-12~12）、`vol`（0.1~10）
- **`@roleVoices`** — 按角色类型（narrator/male/female/girl/boy/child/elderly）指定音色和参数
- 参数优先级：角色名 > 角色类型 > LLM 分析值
- 配置文件向上查找，最近的生效
- 其他扩展也可通过 `xaudio.speakText` 的 `voiceConfig` 参数直接提供相同的音色配置（优先于目录查找，见上文「与其他扩展联动」）

## 常见问题

**Q: 点击朗读后没有声音？**

外部播放器依赖本机 Chromium 内核浏览器（Chrome / Edge 等）。若未检测到，会提示手动播放；也可通过 `xaudio.browserPath` 指定浏览器路径。

**Q: 分角色朗读需要额外配置吗？**

需要。运行 **「配置角色分析」** 选择 AI 来源：Copilot 内置模型，或 OpenAI 兼容接口（如 DeepSeek，需相应 API 密钥）。

**Q: 豆包音频场景和普通朗读有什么区别？**

两者完全隔离。普通朗读按句拆分、逐段合成并带缓存；豆包场景把整段文本当作一条 Prompt 端到端生成，适合带角色、情绪、音效和背景音乐的完整场景，不适合超长文本。

**Q: 朗读会消耗什么？**

普通朗读消耗 MiniMax 语音订阅额度；豆包场景消耗火山引擎额度。开启 `xaudio.cacheEnabled` 可让相同文本复用已合成音频。

## 已知问题

- 外部播放器依赖本机 Chromium 内核浏览器；未检测到支持的浏览器时会提示手动播放。
- 豆包音频场景为整段 Prompt 端到端生成，不适合超长文本逐句朗读。

## 更新日志

详见 [CHANGELOG.md](https://github.com/Cameliorn/x-audio/blob/main/CHANGELOG.md)。

## 支持与反馈

- 遇到问题？前往 [GitHub Issues](https://github.com/Cameliorn/x-audio/issues) 反馈
- 项目地址：[Cameliorn/x-audio](https://github.com/Cameliorn/x-audio)

**Enjoy! 🎧**
