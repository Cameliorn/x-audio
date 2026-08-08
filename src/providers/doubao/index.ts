import { t } from '../../i18n';
import { RoleVoiceType } from '../../roleAnalyzerPrompts';
import { TtsProvider } from '../types';
import { inspectDoubaoApiKey } from './apiKey';
import { DoubaoClient } from './client';
import { getDoubaoTtsConfig } from './config';

export const doubaoProvider: TtsProvider = {
  id: 'doubao',
  displayName: '豆包',
  apiKeySecret: 'audioplugin.doubao.apiKey',
  // 仅用于场景命令的密钥管理；不参与普通朗读渠道选择（未注册到 registry）
  readConfig: () => ({ voiceId: '', roleVoices: {} as Readonly<Record<RoleVoiceType, string>> }),
  createClient: () => new DoubaoClient(getDoubaoTtsConfig),
  inspectApiKey: inspectDoubaoApiKey,
  apiKeyHint: () => t('secretManager.setKeyPromptDoubao')
};
