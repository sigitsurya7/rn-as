import { useColorScheme as useSystemColorScheme } from 'react-native';
import { useOptionalThemeSettings } from '@/lib/theme-context';

export function useColorScheme() {
  const ctx = useOptionalThemeSettings();
  if (ctx) return ctx.resolvedScheme;
  return useSystemColorScheme() ?? 'light';
}
