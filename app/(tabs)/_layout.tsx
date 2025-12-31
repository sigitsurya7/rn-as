import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeSettings } from '@/lib/theme-context';

export default function TabLayout() {
  const { colors } = useThemeSettings();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.content,
          borderTopColor: colors.border,
        },
        headerShown: false,
        tabBarButton: HapticTab,
        lazy: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trading',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="chart.line.uptrend.xyaxis" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Riwayat',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="clock.arrow.circlepath" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="web"
        options={{
          title: 'Web',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="safari.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.crop.circle" color={color} />,
        }}
      />
      <Tabs.Screen
        name="personalization"
        options={{
          title: 'Personalisasi',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="slider.horizontal.3" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
