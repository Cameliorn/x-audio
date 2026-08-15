import { t } from '../../common/i18n';
import { RoleVoiceType } from '../../roles/roleAnalyzerPrompts';
import { TtsProvider } from '../types';
import { inspectDoubaoApiKey } from './apiKey';
import { DoubaoClient } from './client';
import { getDoubaoTtsConfig } from './config';

// 豆包渠道不参与分角色朗读，音色映射恒为空（仅满足 TtsProvider 接口形状）
const DOUBAO_EMPTY_ROLE_VOICES: Readonly<Record<RoleVoiceType, string>> = {
  narrator: '',
  male: '',
  female: '',
  girl: '',
  boy: '',
  child: '',
  elderly: ''
};

export const doubaoProvider: TtsProvider = {
  id: 'doubao',
  displayName: '豆包',
  apiKeySecret: 'xaudio.doubao.apiKey',
  // 仅用于场景命令的密钥管理；不参与普通朗读渠道选择（未注册到 registry）
  readConfig: () => ({ voiceId: '', roleVoices: DOUBAO_EMPTY_ROLE_VOICES }),
  createClient: () => new DoubaoClient(getDoubaoTtsConfig),
  inspectApiKey: inspectDoubaoApiKey,
  apiKeyHint: () => t('secretManager.setKeyPromptDoubao')
};
