import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Redirect, Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ensureNotificationPermission, initNotifications } from '@/lib/notifications';
import { ThemeSettingsProvider, useThemeSettings } from '@/lib/theme-context';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <ThemeSettingsProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ThemeSettingsProvider>
  );
}

function RootNavigator() {
  const { resolvedScheme, colors } = useThemeSettings();
  const navTheme = resolvedScheme === 'dark' ? DarkTheme : DefaultTheme;
  const themedNav = {
    ...navTheme,
    colors: {
      ...navTheme.colors,
      background: colors.layout,
      card: colors.content,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  return (
    <ThemeProvider value={themedNav}>
      <AuthGate>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
      </AuthGate>
      <StatusBar style={resolvedScheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const askedPermission = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }

    if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, router, segments]);

  useEffect(() => {
    if (isLoading || askedPermission.current) return;
    askedPermission.current = true;
    initNotifications()
      .then(() => ensureNotificationPermission())
      .catch(() => undefined);
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isAuthenticated && segments[0] !== '(auth)') {
    return <Redirect href="/(auth)/login" />;
  }

  return children;
}
