import { Link, Tabs } from 'expo-router';
import { Pressable, Text, type ColorValue } from 'react-native';

import { useTheme } from '../../src/theme';

/**
 * Expo Go compatible, so no native icon package: the tab glyphs are text.
 */
function Glyph({ label, color }: { label: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 18 }}>{label}</Text>;
}

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.card },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: { backgroundColor: theme.card, borderTopColor: theme.border },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.faint,
        headerRight: () => (
          <Link href="/settings" asChild>
            <Pressable hitSlop={12} style={{ paddingHorizontal: 16 }}>
              <Text style={{ color: theme.accent, fontSize: 18 }}>⚙</Text>
            </Pressable>
          </Link>
        ),
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Props',
          tabBarIcon: ({ color }) => <Glyph label="◆" color={color} />,
        }}
      />
      <Tabs.Screen
        name="week"
        options={{
          title: 'This Week',
          tabBarIcon: ({ color }) => <Glyph label="▤" color={color} />,
        }}
      />
      <Tabs.Screen
        name="compare"
        options={{
          title: 'Compare',
          tabBarIcon: ({ color }) => <Glyph label="⇄" color={color} />,
        }}
      />
      <Tabs.Screen
        name="teams"
        options={{
          title: 'Teams',
          tabBarIcon: ({ color }) => <Glyph label="⬢" color={color} />,
        }}
      />
    </Tabs>
  );
}
