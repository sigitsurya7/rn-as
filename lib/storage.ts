import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_KEYS = {
  tokenV1: 'auth_token_v1',
  tokenApi: 'auth_token_api',
  apiUrl: 'api_url',
  userProfile: 'user_profile',
  deviceId: 'device_id',
  tradeSettings: 'trade_settings',
  tradeSettingsEntry: 'trade_settings.settings',
} as const;

export type StoredAuth = {
  tokenV1: string | null;
  tokenApi: string | null;
  apiUrl: string | null;
  userProfile: string | null;
  deviceId: string | null;
};

export async function loadStoredAuth(): Promise<StoredAuth> {
  const [tokenV1, tokenApi, apiUrl, userProfile, deviceId] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.tokenV1),
    AsyncStorage.getItem(STORAGE_KEYS.tokenApi),
    AsyncStorage.getItem(STORAGE_KEYS.apiUrl),
    AsyncStorage.getItem(STORAGE_KEYS.userProfile),
    AsyncStorage.getItem(STORAGE_KEYS.deviceId),
  ]);

  return { tokenV1, tokenApi, apiUrl, userProfile, deviceId };
}

export async function saveStoredAuth(params: {
  tokenV1: string;
  tokenApi: string;
  apiUrl: string;
  userProfile: string;
  deviceId: string;
}) {
  await Promise.all([
    AsyncStorage.setItem(STORAGE_KEYS.tokenV1, params.tokenV1),
    AsyncStorage.setItem(STORAGE_KEYS.tokenApi, params.tokenApi),
    AsyncStorage.setItem(STORAGE_KEYS.apiUrl, params.apiUrl),
    AsyncStorage.setItem(STORAGE_KEYS.userProfile, params.userProfile),
    AsyncStorage.setItem(STORAGE_KEYS.deviceId, params.deviceId),
  ]);
}

export async function clearStoredAuth() {
  await Promise.all([
    AsyncStorage.removeItem(STORAGE_KEYS.tokenV1),
    AsyncStorage.removeItem(STORAGE_KEYS.tokenApi),
    AsyncStorage.removeItem(STORAGE_KEYS.apiUrl),
    AsyncStorage.removeItem(STORAGE_KEYS.userProfile),
    AsyncStorage.removeItem(STORAGE_KEYS.deviceId),
  ]);
}

export async function loadTradeSettings() {
  const [primary, legacy] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.tradeSettingsEntry),
    AsyncStorage.getItem(STORAGE_KEYS.tradeSettings),
  ]);
  return primary ?? legacy;
}

export async function saveTradeSettings(settings: string) {
  await Promise.all([
    AsyncStorage.setItem(STORAGE_KEYS.tradeSettingsEntry, settings),
    AsyncStorage.setItem(STORAGE_KEYS.tradeSettings, settings),
  ]);
}
