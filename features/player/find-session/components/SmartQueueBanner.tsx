import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { Sparkles, BrainCircuit, Zap } from 'lucide-react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { STRINGS } from '@/constants/strings'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SPACING, SHADOW } from '@/constants/screenLayout'
import { PlayerQueueProfile } from '../types'
import { LinearGradient } from 'expo-linear-gradient'

type SmartQueueBannerProps = {
  smartQueueEnabled: boolean
  smartQueueHydrated: boolean
  playerProfile: PlayerQueueProfile | null
  onToggle: (enabled: boolean) => void
  filteredSessionsCount: number
  loading: boolean
}

export function SmartQueueBanner({
  smartQueueEnabled,
  smartQueueHydrated,
  playerProfile,
  onToggle,
  filteredSessionsCount,
  loading,
}: SmartQueueBannerProps) {
  const theme = useAppTheme()

  if (loading) return null

  return (
    <View style={{ paddingHorizontal: 0, paddingBottom: 24, marginTop: 12, backgroundColor: 'transparent' }}>
      {/* Smart Suggestions Card */}
      <View
        style={{
          borderRadius: RADIUS.xl,
          overflow: 'hidden',
          backgroundColor: 'white',
          borderWidth: 1,
          borderColor: theme.outlineVariant,
          ...SHADOW.xs
        }}
      >
        <LinearGradient
          colors={smartQueueEnabled ? [theme.primary, theme.primaryContainer] : ['#F5F1E8', '#FFFFFF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ padding: 18 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, pr: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <View style={{ 
                  width: 24, height: 24, borderRadius: 12, 
                  backgroundColor: smartQueueEnabled ? 'rgba(255,255,255,0.2)' : theme.primaryContainer,
                  alignItems: 'center', justifyContent: 'center', marginRight: 8
                }}>
                  <BrainCircuit size={14} color={smartQueueEnabled ? 'white' : theme.primary} strokeWidth={2.5} />
                </View>
                <Text style={{ 
                  color: smartQueueEnabled ? 'white' : theme.primary, 
                  fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' 
                }}>
                  SMART MATCHMAKING
                </Text>
              </View>

              <Text style={{ 
                color: smartQueueEnabled ? 'white' : theme.onSurface, 
                fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 20, lineHeight: 24, textTransform: 'uppercase', letterSpacing: -0.2
              }}>
                {smartQueueEnabled ? 'HỆ THỐNG ĐANG SĂN KÈO' : 'CHƯA THẤY KÈO ƯNG Ý?'}
              </Text>
              
              <Text style={{ 
                marginTop: 6,
                color: smartQueueEnabled ? 'rgba(255,255,255,0.8)' : theme.onSurfaceVariant, 
                fontFamily: SCREEN_FONTS.body, fontSize: 13, lineHeight: 20 
              }}>
                {smartQueueEnabled 
                  ? `Hệ thống đang tự động lọc các kèo phù hợp nhất tại ${playerProfile?.city || 'khu vực của bạn'}.`
                  : 'Kích hoạt Gợi ý thông minh để hệ thống tự động tìm và ưu tiên những kèo đấu khớp nhất với bạn.'
                }
              </Text>

              <TouchableOpacity
                onPress={() => onToggle(!smartQueueEnabled)}
                disabled={!smartQueueHydrated}
                style={{
                  marginTop: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  alignSelf: 'flex-start',
                  backgroundColor: smartQueueEnabled ? 'white' : theme.primary,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: RADIUS.full,
                  opacity: !smartQueueHydrated ? 0.6 : 1,
                  ...SHADOW.xs
                }}
              >
                <Sparkles
                  size={14}
                  color={smartQueueEnabled ? theme.primary : 'white'}
                  strokeWidth={3}
                />
                <Text
                  style={{
                    marginLeft: 8,
                    color: smartQueueEnabled ? theme.primary : 'white',
                    fontFamily: SCREEN_FONTS.cta,
                    fontSize: 12,
                    letterSpacing: 0.5
                  }}
                >
                  {smartQueueEnabled ? 'TẮT GỢI Ý' : 'KÍCH HOẠT NGAY'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ 
              width: 70, height: 70, borderRadius: 35, 
              backgroundColor: smartQueueEnabled ? 'rgba(255,255,255,0.15)' : 'white', 
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: smartQueueEnabled ? 'rgba(255,255,255,0.3)' : theme.outlineVariant,
              ...SHADOW.xs
            }}>
              {smartQueueEnabled ? (
                <Sparkles size={32} color="white" strokeWidth={1.5} />
              ) : (
                <Zap size={32} color={theme.outline} strokeWidth={1.5} />
              )}
            </View>
          </View>
        </LinearGradient>
      </View>
    </View>
  )
}
