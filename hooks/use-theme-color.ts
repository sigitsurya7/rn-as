/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOptionalThemeSettings } from '@/lib/theme-context';

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  const theme = useColorScheme() ?? 'light';
  const themeSettings = useOptionalThemeSettings();
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  }

  if (themeSettings) {
    return themeSettings.colors[colorName] ?? Colors[theme][colorName];
  }

  return Colors[theme][colorName];
}
