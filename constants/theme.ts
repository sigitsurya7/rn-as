/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

export type ThemeScheme = 'light' | 'dark';

export type ThemePalette = {
  id: string;
  name: string;
  light: ThemeTokens;
  dark: ThemeTokens;
};

export type ThemeTokens = {
  layout: string;
  content: string;
  base: string;
  primary: string;
  secondary: string;
  text: string;
  textMuted: string;
  border: string;
};

export const ThemePalettes: ThemePalette[] = [
  {
    id: 'ocean',
    name: 'Ocean',
    light: {
      layout: '#F2F8FB',
      content: '#FFFFFF',
      base: '#0F172A',
      primary: '#0EA5E9',
      secondary: '#14B8A6',
      text: '#0F172A',
      textMuted: '#607089',
      border: '#E2E8F0',
    },
    dark: {
      layout: '#041B2D',
      content: '#0B2238',
      base: '#E2E8F0',
      primary: '#38BDF8',
      secondary: '#2DD4BF',
      text: '#E2E8F0',
      textMuted: '#94A3B8',
      border: '#1E293B',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: {
      layout: '#F4F7F3',
      content: '#FFFFFF',
      base: '#1F2937',
      primary: '#15803D',
      secondary: '#D97706',
      text: '#1F2937',
      textMuted: '#6B7280',
      border: '#E5E7EB',
    },
    dark: {
      layout: '#0F1A14',
      content: '#111F17',
      base: '#E5E7EB',
      primary: '#22C55E',
      secondary: '#F59E0B',
      text: '#E5E7EB',
      textMuted: '#94A3B8',
      border: '#1F2937',
    },
  },
  {
    id: 'rose',
    name: 'Rose',
    light: {
      layout: '#FFF5F5',
      content: '#FFFFFF',
      base: '#1F2937',
      primary: '#E11D48',
      secondary: '#7C3AED',
      text: '#1F2937',
      textMuted: '#6B7280',
      border: '#F3E8FF',
    },
    dark: {
      layout: '#1A0B12',
      content: '#221018',
      base: '#FCE7F3',
      primary: '#FB7185',
      secondary: '#A78BFA',
      text: '#FCE7F3',
      textMuted: '#C4B5FD',
      border: '#3F1B2A',
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    light: {
      layout: '#F7F7FB',
      content: '#FFFFFF',
      base: '#111827',
      primary: '#2563EB',
      secondary: '#F97316',
      text: '#111827',
      textMuted: '#6B7280',
      border: '#E5E7EB',
    },
    dark: {
      layout: '#0B1120',
      content: '#111827',
      base: '#F8FAFC',
      primary: '#60A5FA',
      secondary: '#F59E0B',
      text: '#F8FAFC',
      textMuted: '#94A3B8',
      border: '#1F2937',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    light: {
      layout: '#F5F5F5',
      content: '#FFFFFF',
      base: '#111827',
      primary: '#111827',
      secondary: '#6B7280',
      text: '#111827',
      textMuted: '#6B7280',
      border: '#E5E7EB',
    },
    dark: {
      layout: '#0B0F14',
      content: '#111827',
      base: '#F3F4F6',
      primary: '#E5E7EB',
      secondary: '#94A3B8',
      text: '#F3F4F6',
      textMuted: '#94A3B8',
      border: '#1F2937',
    },
  },
];

export function getThemeColors(paletteId: string, scheme: ThemeScheme) {
  const palette =
    ThemePalettes.find((item) => item.id === paletteId) ?? ThemePalettes[0];
  const tokens = palette[scheme];
  return {
    ...tokens,
    tint: tokens.primary,
    icon: tokens.secondary,
    tabIconDefault: tokens.textMuted,
    tabIconSelected: tokens.primary,
    background: tokens.layout,
    text: tokens.text,
  };
}

export const Colors = {
  light: getThemeColors('ocean', 'light'),
  dark: getThemeColors('ocean', 'dark'),
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
