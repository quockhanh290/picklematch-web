import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { Sparkles, BrainCircuit, Zap } from 'lucide-react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { STRINGS } from '@/constants/strings'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SPACING, SHADOW } from '@/constants/screenLayout'
import { PlayerQueueProfile } from '../types'
import { LinearGradient } from 'expo-linear-gradient'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()

  if (loading) return null

  return (
    <View style={{ paddingHorizontal: 0, paddingBottom: 24, marginTop: 12, backgroundColor: 'transparent' }}>
      {/* Smart Suggestions Card */}
      <View
        style={{
          borderRadius: RADIUS.xl,
          overflow: 'hidden',
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.outlineVariant,
          ...SHADOW.xs
        }}
      >
        <LinearGradient
          colors={smartQueueEnabled ? [theme.primary, theme.primaryContainer] : [theme.surfaceAlt, theme.surface]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ padding: 18 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <View style={{ 
                  width: 24, height: 24, borderRadius: 12, 
                  backgroundColor: smartQueueEnabled ? 'rgba(255,255,255,0.2)' : theme.primaryContainer,
                  alignItems: 'center', justifyContent: 'center', marginRight: 8
                }}>
                  <BrainCircuit size={14} color={smartQueueEnabled ? theme.onPrimary : theme.primary} strokeWidth={2.5} />
                </View>
                <Text style={{ 
                  color: smartQueueEnabled ? theme.onPrimary : theme.primary, 
                  fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' 
                }}>
                  {t('smart_queue_banner.label')}
                </Text>
              </View>

              <Text style={{ 
                color: smartQueueEnabled ? theme.onPrimary : theme.onSurface, 
                fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 20, lineHeight: 24, textTransform: 'uppercase', letterSpacing: -0.2
              }}>
                {smartQueueEnabled ? t('smart_queue_banner.title_enabled') : t('smart_queue_banner.title_disabled')}
              </Text>
              
              <Text style={{ 
                marginTop: 6,
                color: smartQueueEnabled ? 'rgba(255,255,255,0.8)' : theme.onSurfaceVariant, 
                fontFamily: SCREEN_FONTS.body, fontSize: 13, lineHeight: 20 
              }}>
                {smartQueueEnabled 
                  ? t('smart_queue_banner.desc_enabled', { city: playerProfile?.city || t('player_session_card.default_city') })
                  : t('smart_queue_banner.desc_disabled')
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
                  backgroundColor: smartQueueEnabled ? theme.surface : theme.primary,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: RADIUS.full,
                  opacity: !smartQueueHydrated ? 0.6 : 1,
                  ...SHADOW.xs
                }}
              >
                <Sparkles
                  size={14}
                  color={smartQueueEnabled ? theme.primary : theme.onPrimary}
                  strokeWidth={3}
                />
                <Text
                  style={{
                    marginLeft: 8,
                    color: smartQueueEnabled ? theme.primary : theme.onPrimary,
                    fontFamily: SCREEN_FONTS.cta,
                    fontSize: 12,
                    letterSpacing: 0.5
                  }}
                >
                  {smartQueueEnabled ? t('smart_queue_banner.btn_disable') : t('smart_queue_banner.btn_enable')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ 
              width: 70, height: 70, borderRadius: 35, 
              backgroundColor: smartQueueEnabled ? 'rgba(255,255,255,0.15)' : theme.surface, 
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: smartQueueEnabled ? 'rgba(255,255,255,0.3)' : theme.outlineVariant,
              ...SHADOW.xs
            }}>
              {smartQueueEnabled ? (
                <Sparkles size={32} color={theme.onPrimary} strokeWidth={1.5} />
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
