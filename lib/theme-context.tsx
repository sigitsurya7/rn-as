import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { ThemePalettes, ThemeScheme, getThemeColors } from '@/constants/theme';

const STORAGE_KEYS = {
  scheme: 'theme_scheme',
  palette: 'theme_palette',
};

export type ThemeMode = 'system' | ThemeScheme;

type ThemeContextValue = {
  scheme: ThemeMode;
  resolvedScheme: ThemeScheme;
  paletteId: string;
  colors: ReturnType<typeof getThemeColors>;
  palettes: typeof ThemePalettes;
  setScheme: (mode: ThemeMode) => void;
  setPaletteId: (paletteId: string) => void;
};

const ThemeSettingsContext = createContext<ThemeContextValue | null>(null);

export function ThemeSettingsProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme() ?? 'light';
  const [scheme, setSchemeState] = useState<ThemeMode>('system');
  const [paletteId, setPaletteIdState] = useState<string>('ocean');

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.scheme),
      AsyncStorage.getItem(STORAGE_KEYS.palette),
    ])
      .then(([storedScheme, storedPalette]) => {
        if (storedScheme === 'light' || storedScheme === 'dark' || storedScheme === 'system') {
          setSchemeState(storedScheme);
        }
        if (storedPalette) {
          setPaletteIdState(storedPalette);
        }
      })
      .catch(() => undefined);
  }, []);

  const setScheme = useCallback((mode: ThemeMode) => {
    setSchemeState(mode);
    AsyncStorage.setItem(STORAGE_KEYS.scheme, mode).catch(() => undefined);
  }, []);

  const setPaletteId = useCallback((nextPalette: string) => {
    setPaletteIdState(nextPalette);
    AsyncStorage.setItem(STORAGE_KEYS.palette, nextPalette).catch(() => undefined);
  }, []);

  const resolvedScheme: ThemeScheme = scheme === 'system' ? systemScheme : scheme;
  const colors = useMemo(
    () => getThemeColors(paletteId, resolvedScheme),
    [paletteId, resolvedScheme]
  );

  const value = useMemo(
    () => ({
      scheme,
      resolvedScheme,
      paletteId,
      colors,
      palettes: ThemePalettes,
      setScheme,
      setPaletteId,
    }),
    [scheme, resolvedScheme, paletteId, colors, setScheme, setPaletteId]
  );

  return <ThemeSettingsContext.Provider value={value}>{children}</ThemeSettingsContext.Provider>;
}

export function useThemeSettings() {
  const ctx = useContext(ThemeSettingsContext);
  if (!ctx) {
    throw new Error('useThemeSettings must be used within ThemeSettingsProvider');
  }
  return ctx;
}

export function useOptionalThemeSettings() {
  return useContext(ThemeSettingsContext);
}
