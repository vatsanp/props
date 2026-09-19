import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useRecords } from '../../src/api/queries';
import { SectionTitle } from '../../src/components/common';
import { TEAMS, TEAM_IDS } from '../../src/domain/teams';
import { useTheme } from '../../src/theme';

const DIVISIONS = [
  'AFC East', 'AFC North', 'AFC South', 'AFC West',
  'NFC East', 'NFC North', 'NFC South', 'NFC West',
];

export default function TeamsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const records = useRecords();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingBottom: 32 }}
    >
      {DIVISIONS.map((division) => (
        <View key={division}>
          <SectionTitle>{division}</SectionTitle>
          <View style={{ paddingHorizontal: 12, flexDirection: 'row', flexWrap: 'wrap' }}>
            {TEAM_IDS.filter((id) => TEAMS[id].division === division).map((id) => {
              const record = records.data?.teams?.[id];
              return (
                <Pressable
                  key={id}
                  onPress={() => router.push(`/team/${id}`)}
                  style={{
                    width: '50%',
                    padding: 4,
                  }}
                >
                  <View
                    style={{
                      backgroundColor: theme.card,
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: theme.radius,
                      padding: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <View
                      style={{
                        width: 6,
                        height: 34,
                        borderRadius: 3,
                        backgroundColor: TEAMS[id].primary,
                      }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontWeight: '700' }}>{id}</Text>
                      <Text style={{ color: theme.muted, fontSize: 12 }} numberOfLines={1}>
                        {record
                          ? `${record.w}-${record.l}${record.t ? `-${record.t}` : ''}`
                          : TEAMS[id].nickname}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
