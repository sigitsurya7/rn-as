import { EventEmitter, requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type NativeBotModule = {
  start: (payload: string) => Promise<void>;
  stop: () => Promise<void>;
  update: (payload: string) => Promise<void>;
};

const nativeModule = (() => {
  try {
    return requireNativeModule('NativeBotService') as NativeBotModule;
  } catch {
    return null;
  }
})();

const emitter = nativeModule ? new EventEmitter(nativeModule as any) : null;

export const nativeBotAvailable = () => Platform.OS === 'android' && !!nativeModule;

export const startNativeBot = async (payload: string) => {
  if (!nativeModule) return;
  await nativeModule.start(payload);
};

export const stopNativeBot = async () => {
  if (!nativeModule) return;
  await nativeModule.stop();
};

export const updateNativeBot = async (payload: string) => {
  if (!nativeModule) return;
  await nativeModule.update(payload);
};

export const onNativeBotEvent = (
  handler: (event: { type: string; payload: string }) => void
) => {
  if (!emitter) return () => undefined;
  const subscription = emitter.addListener('event', handler);
  return () => subscription.remove();
};
