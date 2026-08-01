# AudioPlugin 朗读助手

在 VS Code 中将文本合成为语音并朗读。支持普通朗读、分角色朗读、背景音效，并可作为 Copilot Agent 工具使用。

语音合成采用**渠道（Provider）**架构：默认使用 MiniMax 渠道，未来可扩展更多 TTS 渠道。

## 功能

- **朗读选中文本** — 选中编辑器内容，一键合成语音
- **朗读输入文本** — 手动输入文本后合成
- **分角色朗读** — 自动分析小说角色与对白，为每个角色分配不同音色
- **背景音效** — 自动分析文本场景氛围，匹配对应音效素材
- **播放控制** — 支持暂停/恢复、停止播放
- **Copilot 集成** — 作为 Language Model Tool（`audioplugin_speak`）供 Copilot Agent 调用
- **音频缓存** — 相同文本自动复用已合成的音频

## 使用方式

### 普通朗读

1. 运行 **AudioPlugin 朗读助手：设置密钥**，粘贴当前渠道的 API 密钥
2. 在编辑器中选中文本，右键选择 **朗读选中文本**
3. 或通过命令面板运行 **朗读输入文本**，手动输入内容

### 分角色朗读

1. 运行 **AudioPlugin 朗读助手：配置角色分析**，设置 DeepSeek API 密钥
2. 打开小说文本，运行 **分角色朗读文档**
3. 确认角色与音色分配后开始合成

### 背景音效

1. 运行 **选择音效素材库文件夹**，选择一个按场景分类的音频目录
2. 分角色朗读时，DeepSeek 自动分析场景并匹配音效

> 音效素材库结构示例：`sfx/forest/`, `sfx/rain/`, `sfx/battle/` 等，子目录名即为场景分类。

## TTS 渠道（Provider）

通过设置 `audioplugin.provider` 选择语音合成渠道（默认 `minimax`）。每个渠道的专属设置在 `audioplugin.<渠道>.*` 下：

- **`minimax`（默认）** — MiniMax 语音合成，设置项见下表（`audioplugin.minimax.*`）

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
| `audioplugin.speakSelection` | 朗读选中文本 |
| `audioplugin.speakInput` | 朗读输入文本 |
| `audioplugin.speakDocumentWithRoles` | 分角色朗读文档 |
| `audioplugin.setApiKey` | 设置当前渠道 API 密钥 |
| `audioplugin.configureRoleAnalysis` | 配置角色分析（DeepSeek） |
| `audioplugin.setSoundEffectsDir` | 选择音效素材库 |
| `audioplugin.pause` | 暂停/恢复播放 |
| `audioplugin.stop` | 停止播放 |

## 设置

通过 VS Code 设置面板调整（`audioplugin.*`）。配置项按适用范围分类标注：

- **[通用]** — 所有渠道、所有朗读模式
- **[MiniMax]** — 仅 MiniMax 渠道
- **[分角色]** — 仅分角色朗读
- **[普通朗读]** — 仅普通朗读（朗读选中/输入文本）

### 通用设置（`audioplugin.*`）

| 设置 | 说明 | 默认值 |
|---|---|---|
| `provider` | [通用] 语音合成渠道 | `minimax` |
| `cacheEnabled` | [通用] 启用音频缓存 | `true` |
| `maxTextLength` | [通用] 单次请求最大字符数 | `10000` |
| `requestTimeoutMs` | [通用] 请求超时（毫秒） | `60000` |
| `maxConcurrentRequests` | [分角色] 多角色合成最大并发请求数（1~8） | `3` |
| `browserPath` | [通用] 外部播放器浏览器路径 | — |
| `soundEffectsDir` | [分角色] 音效素材库目录 | — |
| `roleAnalysis.*` | [分角色] 角色分析配置（DeepSeek/Copilot） | — |

### MiniMax 渠道设置（`audioplugin.minimax.*`）

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

## 要求

- VS Code `^1.100.0`
- 当前渠道的 API 密钥（MiniMax 语音订阅或 Token Plan）
- 分角色朗读需 DeepSeek API 密钥
