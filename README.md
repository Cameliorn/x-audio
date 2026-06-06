# MiniMax 文字转语音

在 VS Code 中通过 MiniMax API 将文本合成为语音。支持朗读选中文本、输入文本，并可作为 Copilot Agent 工具使用。

## 功能

- **朗读选中文本**：右键菜单或命令面板，一键朗读编辑器中的选中内容
- **朗读输入文本**：手动输入文本后合成语音
- **Copilot 集成**：作为 Language Model Tool（`minimax_tts_speak`）供 Copilot Agent 调用
- **音频缓存**：相同文本自动复用已合成的音频，节省额度

## 使用方式

1. 运行 `MiniMax 文字转语音：设置密钥`，粘贴 MiniMax API 密钥
2. 在编辑器中选中文本，右键选择 `朗读选中文本`
3. 或通过 Copilot 让 Agent 直接调用语音合成

## 设置

所有配置项通过 VS Code 设置面板调整（`minimaxTts.*`），包括音色、语速、音量、音调、音频格式等。

## 要求

- VS Code `^1.100.0`
- MiniMax API 密钥（语音订阅或 Token Plan）
