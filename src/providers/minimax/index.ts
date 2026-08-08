import { t } from '../../i18n';
import { TtsProvider } from '../types';
import { inspectMiniMaxApiKey } from './apiKey';
import { MiniMaxClient } from './client';
import { getMiniMaxConfig } from './config';

export const minimaxProvider: TtsProvider = {
  id: 'minimax',
  displayName: 'MiniMax',
  apiKeySecret: 'audioplugin.minimax.apiKey',
  readConfig: () => getMiniMaxConfig(),
  createClient: () => new MiniMaxClient(getMiniMaxConfig),
  inspectApiKey: inspectMiniMaxApiKey,
  apiKeyHint: () => t('secretManager.setKeyPromptMiniMax')
};
