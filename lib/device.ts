import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from './storage';

export const DEVICE_TYPE = 'web';

export function generateDeviceId(): string {
  return uuidv4().replace(/-/g, '');
}

export async function getOrCreateDeviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(STORAGE_KEYS.deviceId);
  if (stored) return stored;
  const deviceId = generateDeviceId();
  await AsyncStorage.setItem(STORAGE_KEYS.deviceId, deviceId);
  return deviceId;
}

export async function saveDeviceId(deviceId: string) {
  await AsyncStorage.setItem(STORAGE_KEYS.deviceId, deviceId);
}
