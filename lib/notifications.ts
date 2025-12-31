import type { NotificationPermissionsStatus } from 'expo-notifications';
import Constants from 'expo-constants';

const isExpoGo = Constants.appOwnership === 'expo';

const expoGoPermissions: NotificationPermissionsStatus = {
  granted: true,
  canAskAgain: true,
  status: 'granted' as NotificationPermissionsStatus['status'],
  expires: 'never',
};

export async function ensureNotificationPermission() {
  if (isExpoGo) {
    return expoGoPermissions;
  }
  const Notifications = await import('expo-notifications');
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return current;
  }
  return Notifications.requestPermissionsAsync();
}

export async function initNotifications() {
  if (isExpoGo) return;
  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Constants.platform?.android) {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
}

export async function sendLocalNotification(params: { title: string; body: string }) {
  if (isExpoGo) return null;
  const Notifications = await import('expo-notifications');
  return Notifications.scheduleNotificationAsync({
    content: {
      channelId: 'default',
      title: params.title,
      body: params.body,
      sound: true,
    },
    trigger: null,
  });
}
