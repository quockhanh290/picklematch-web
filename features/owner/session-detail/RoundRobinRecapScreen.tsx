import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '@/lib/theme-context';
import { SCREEN_FONTS } from '@/constants/typography';
import type { SessionMatch } from '@/hooks/useSessionDetail';
import { BrandedFooter } from '@/components/design/BrandedFooter';

interface Props {
  sessionId: string;
}

export function RoundRobinRecapScreen({ sessionId }: Props) {
  const theme = useAppTheme();
  const [standings, setStandings] = useState<any[]>([]);

  useEffect(() => {
    if (sessionId) fetchStandings();
  }, [sessionId]);

  const fetchStandings = async () => {
    // DUMMY DATA (Replace with actual API call if available)
    setStandings([
      { player_id: '1', player_name: 'Quốc Khánh', wins: 4, losses: 0, points_for: 44, points_against: 20, point_diff: 24, total_points: 12 },
      { player_id: '2', player_name: 'Minh Tuấn', wins: 4, losses: 0, points_for: 44, points_against: 20, point_diff: 24, total_points: 12 },
      { player_id: '3', player_name: 'Hoàng Nam', wins: 2, losses: 2, points_for: 35, points_against: 35, point_diff: 0, total_points: 6 },
      { player_id: '4', player_name: 'Việt Anh', wins: 2, losses: 2, points_for: 35, points_against: 35, point_diff: 0, total_points: 6 },
      { player_id: '5', player_name: 'Thế Vinh', wins: 0, losses: 4, points_for: 20, points_against: 44, point_diff: -24, total_points: 0 },
      { player_id: '6', player_name: 'Duy Mạnh', wins: 0, losses: 4, points_for: 20, points_against: 44, point_diff: -24, total_points: 0 },
    ]);
  };

  const sessionStats = useMemo(() => {
    const totalPoints = standings.reduce((acc, s) => acc + (s.points_for || 0), 0);
    const totalSlots = standings.reduce((acc, s) => acc + (s.wins || 0) + (s.losses || 0), 0);
    return { totalMatches: Math.ceil(totalSlots / 4), totalPoints };
  }, [standings]);

  const sorted = useMemo(() => [...standings].sort((a, b) => b.total_points - a.total_points || b.point_diff - a.point_diff), [standings]);

  return (
    <View style={{ flex: 1, backgroundColor: 'white' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={['#083D2B', '#0F6E56']} style={{ padding: 24, paddingBottom: 32 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 32, color: 'white', marginBottom: 4 }}>BẢNG XẾP HẠNG</Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>Kết quả thi đấu Round Robin</Text>
          
          <View style={{ flexDirection: 'row', marginTop: 24, gap: 16 }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', padding: 12, borderRadius: 12 }}>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontFamily: SCREEN_FONTS.label }}>TRẬN ĐẤU</Text>
              <Text style={{ color: 'white', fontSize: 24, fontFamily: SCREEN_FONTS.headline }}>{sessionStats.totalMatches}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', padding: 12, borderRadius: 12 }}>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontFamily: SCREEN_FONTS.label }}>TỔNG ĐIỂM</Text>
              <Text style={{ color: 'white', fontSize: 24, fontFamily: SCREEN_FONTS.headline }}>{sessionStats.totalPoints}</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={{ padding: 16 }}>
          {sorted.map((item, index) => (
            <View key={item.player_id} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: index % 2 === 0 ? '#F5F1E8' : 'white', borderRadius: 12, marginBottom: 8 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : 'transparent', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, color: index < 3 ? 'white' : '#B4B2A9' }}>{index + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 15, fontWeight: '700' }}>{item.player_name}</Text>
                <Text style={{ fontSize: 11, color: '#7A8884' }}>{item.wins} thắng - {item.losses} thua</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: '#0F6E56' }}>{item.total_points}</Text>
                <Text style={{ fontSize: 10, color: '#7A8884' }}>ĐIỂM</Text>
              </View>
            </View>
          ))}
        </View>
        <BrandedFooter />
      </ScrollView>
    </View>
  );
}
