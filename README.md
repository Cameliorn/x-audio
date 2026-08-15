# x-audio 朗读助手

在 VS Code 中将文本合成为语音并朗读。支持普通朗读、分角色朗读，并可作为 Copilot Agent 工具使用。

语音合成采用**渠道（Provider）**架构：普通朗读默认使用 MiniMax 渠道；豆包音频生成（Seed-Audio 1.0）通过独立的场景命令与智能体工具使用，与普通朗读完全隔离。

## 功能

- **朗读选中文本** — 选中编辑器内容，一键合成语音
- **分角色朗读** — 自动分析小说角色与对白，为每个角色分配不同音色
- **播放控制** — 支持暂停/恢复、停止播放
- **Copilot 集成** — 作为 Language Model Tool（`xaudio_speak`）供 Copilot Agent 调用
- **音频缓存** — 相同文本自动复用已合成的音频

## 使用方式

### 普通朗读

1. 运行 **x-audio 朗读助手：设置密钥**，粘贴当前渠道的 API 密钥
2. 在编辑器中选中文本，右键选择 **朗读选中文本**

### 分角色朗读

1. 运行 **x-audio 朗读助手：配置角色分析**，设置 DeepSeek API 密钥
2. 打开小说文本，运行 **分角色朗读文档**
3. 确认角色与音色分配后开始合成

## TTS 渠道（Provider）

通过设置 `xaudio.provider` 选择语音合成渠道（默认 `minimax`）。每个渠道的专属设置在 `xaudio.<渠道>.*` 下：

- **`minimax`（默认）** — MiniMax 语音合成，设置项见下表（`xaudio.minimax.*`）

普通朗读（`xaudio.speakSelection`）、分角色朗读与 `xaudio_speak` 智能体工具仅使用当前渠道（MiniMax）。豆包不参与这些流程。

## 豆包音频场景（与普通朗读完全隔离）

豆包音频生成模型（Seed-Audio 1.0）通过**独立的命令与智能体工具**使用：选中文本被视为**一条完整 Prompt**，单次请求端到端生成综合语音场景（多角色对白、语气情绪、音效、背景音乐），不经过普通朗读的分句/缓存流程。

- **右键命令** `xaudio.speakScenePrompt`（用豆包生成音频场景）— 选中文本作为 Prompt，生成并播放
- **智能体工具** `xaudio_scene` — Copilot 智能体可调用，输入 `prompt` 字段生成并播放音频场景
- 密钥：运行 **「x-audio 朗读助手：设置密钥」** 粘贴[火山引擎语音 API Key](https://console.volcengine.com/speech/new/setting/apikeys)（与普通朗读的 MiniMax 密钥相互独立存储）
- Prompt 上限 3000 字符，单次输出最长 120 秒

示例 Prompt：

```
深夜的废弃工厂，雨滴打在铁皮屋顶。男主（低沉警惕）："你听到什么声音了吗？"
女主（压低声音）："好像……有人在跟踪我们。"背景音乐悬疑紧张，弦乐渐强，
远处偶尔传来雷声。
```

## 配置文件 `.ttsvoices.json`

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

## 命令

| 命令 | 说明 |
|---|---|
| `xaudio.speakSelection` | 朗读选中文本 |
| `xaudio.speakDocumentWithRoles` | 分角色朗读文档 |
| `xaudio.speakScenePrompt` | 用豆包生成音频场景（选中文本为完整 Prompt） |
| `xaudio.setApiKey` | 设置当前渠道 API 密钥 |
| `xaudio.configureRoleAnalysis` | 配置角色分析（DeepSeek） |
| `xaudio.pause` | 暂停/恢复播放 |
| `xaudio.stop` | 停止播放 |

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

## 要求

- VS Code `^1.100.0`
- 普通朗读需 MiniMax 语音订阅或 Token Plan 密钥
- 豆包音频场景需[火山引擎语音 API Key](https://console.volcengine.com/speech/new/setting/apikeys)（独立存储）
- 分角色朗读需 DeepSeek API 密钥
