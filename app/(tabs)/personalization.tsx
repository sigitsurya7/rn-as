import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useThemeSettings } from '@/lib/theme-context';

const MODE_OPTIONS = [
  { id: 'system', label: 'Sistem' },
  { id: 'light', label: 'Terang' },
  { id: 'dark', label: 'Gelap' },
] as const;

export default function PersonalizationScreen() {
  const { colors, palettes, scheme, setScheme, paletteId, setPaletteId } = useThemeSettings();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.layout }]}>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.layout }]}
        contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>Personalisasi</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Atur mode tema dan warna utama aplikasi sesuai preferensi kamu.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.content, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Mode Tema</Text>
          <View style={[styles.segment, { borderColor: colors.border }]}>
            {MODE_OPTIONS.map((item) => (
              <Pressable
                key={item.id}
                style={[
                  styles.segmentButton,
                  scheme === item.id && { backgroundColor: colors.primary },
                ]}
                onPress={() => setScheme(item.id)}>
                <Text
                  style={[
                    styles.segmentText,
                    scheme === item.id && { color: colors.content },
                    scheme !== item.id && { color: colors.textMuted },
                  ]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.content, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Tema Warna</Text>
          <Text style={[styles.cardHint, { color: colors.textMuted }]}>
            Pilih palet warna untuk Layout, Content, Base, Primary, dan Secondary.
          </Text>

          <View style={styles.paletteGrid}>
            {palettes.map((palette) => {
              const tokens = palette.light;
              const isActive = palette.id === paletteId;
              return (
                <Pressable
                  key={palette.id}
                  style={[
                    styles.paletteCard,
                    { borderColor: isActive ? colors.primary : colors.border },
                  ]}
                  onPress={() => setPaletteId(palette.id)}>
                  <Text style={[styles.paletteTitle, { color: colors.text }]}>{palette.name}</Text>
                  <View style={styles.swatchRow}>
                    <View style={[styles.swatch, { backgroundColor: tokens.layout }]} />
                    <View style={[styles.swatch, { backgroundColor: tokens.content }]} />
                    <View style={[styles.swatch, { backgroundColor: tokens.base }]} />
                    <View style={[styles.swatch, { backgroundColor: tokens.primary }]} />
                    <View style={[styles.swatch, { backgroundColor: tokens.secondary }]} />
                  </View>
                  <Text style={[styles.paletteLabel, { color: colors.textMuted }]}>
                    Layout · Content · Base · Primary · Secondary
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    gap: 18,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  cardHint: {
    fontSize: 12,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '600',
  },
  paletteGrid: {
    gap: 12,
  },
  paletteCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  paletteTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  paletteLabel: {
    fontSize: 10,
  },
  swatchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
});
