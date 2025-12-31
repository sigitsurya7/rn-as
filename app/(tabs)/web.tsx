import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { getThemeColors } from '@/constants/theme';
import { useThemeSettings } from '@/lib/theme-context';
import { loadStoredAuth } from '@/lib/storage';
import { DEVICE_TYPE, getOrCreateDeviceId } from '@/lib/device';
import { WEBVIEW_USER_AGENT } from '@/lib/webview-constants';

export default function WebScreen() {
  const { colors } = useThemeSettings();
  const [tokenApi, setTokenApi] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);

  const focusScript = useMemo(
    () =>
      `(function() {
        document.addEventListener('click', function(e) {
          if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
            e.target.focus();
          }
        });
      })(); true;`,
    []
  );

  const cookieScript = useMemo(() => {
    if (!tokenApi || !deviceId) return 'true;';
    const safeToken = encodeURIComponent(tokenApi);
    const safeDevice = encodeURIComponent(deviceId);
    return `(function() {
      try {
        document.cookie = "device_type=web; path=/; domain=stockity.id";
        document.cookie = "device_id=${safeDevice}; path=/; domain=stockity.id";
        document.cookie = "authtoken=${safeToken}; path=/; domain=stockity.id";
        document.cookie = "device_type=web; path=/; domain=.stockity.id";
        document.cookie = "device_id=${safeDevice}; path=/; domain=.stockity.id";
        document.cookie = "authtoken=${safeToken}; path=/; domain=.stockity.id";
      } catch (e) {}
    })(); true;`;
  }, [deviceId, tokenApi]);

  useEffect(() => {
    let isMounted = true;
    const hydrate = async () => {
      try {
        const stored = await loadStoredAuth();
        const nextDeviceId = stored.deviceId ?? (await getOrCreateDeviceId());
        if (!stored.tokenApi) {
          throw new Error('Token API v2 belum tersedia. Login ulang dulu.');
        }
        if (isMounted) {
          setTokenApi(stored.tokenApi);
          setDeviceId(nextDeviceId);
        }
      } catch (err) {
        if (isMounted) {
          setBootError(err instanceof Error ? err.message : 'Gagal memuat sesi web.');
        }
      }
    };
    hydrate();
    return () => {
      isMounted = false;
    };
  }, []);

  const webHeaders = useMemo(() => {
    if (!tokenApi || !deviceId) return undefined;
    return {
      'Authorization-Token': tokenApi,
      'Device-Id': deviceId,
      'Device-Type': DEVICE_TYPE,
    } as Record<string, string>;
  }, [deviceId, tokenApi]);
  const isReady = Boolean(tokenApi && deviceId);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {bootError ? (
          <View style={styles.loaderWrap}>
            <Text style={styles.loaderText}>{bootError}</Text>
          </View>
        ) : isLoading || !isReady ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.text} />
            <Text style={styles.loaderText}>
              Memuat trading web {Math.round(progress * 100)}%
            </Text>
          </View>
        ) : null}

        {isReady ? (
          <WebView
            source={{
              uri: 'https://stockity.id/trading',
              headers: webHeaders,
            }}
            onLoadStart={() => setIsLoading(true)}
            onLoadEnd={() => setIsLoading(false)}
            onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress ?? 0)}
            javaScriptEnabled
            domStorageEnabled
            javaScriptCanOpenWindowsAutomatically
            setSupportMultipleWindows={false}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            mixedContentMode="always"
            cacheEnabled
            cacheMode="LOAD_DEFAULT"
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            injectedJavaScriptBeforeContentLoaded={cookieScript}
            injectedJavaScript={focusScript}
            userAgent={WEBVIEW_USER_AGENT}
            style={styles.webview}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ReturnType<typeof getThemeColors>) =>
  StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.layout,
  },
  container: {
    flex: 1,
    backgroundColor: colors.layout,
  },
  loaderWrap: {
    position: 'absolute',
    zIndex: 10,
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: colors.content,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: colors.base,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  loaderText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '600',
  },
  webview: {
    flex: 1,
  },
  });
