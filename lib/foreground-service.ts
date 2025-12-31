import { requireNativeModule } from 'expo-modules-core';

type ForegroundServiceNativeModule = {
  start: (title: string, body: string) => void;
  stop: () => void;
};

const nativeModule = (() => {
  try {
    return requireNativeModule('ForegroundService') as ForegroundServiceNativeModule;
  } catch {
    return null;
  }
})();

export function startForegroundService(title: string, body: string) {
  nativeModule?.start(title, body);
}

export function stopForegroundService() {
  nativeModule?.stop();
}
