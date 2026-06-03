import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  View,
  Text,
  StyleSheet,
  Share,
  Platform,
  Alert,
  ScrollView,
  TouchableOpacity,
} from 'react-native'
import * as Haptics from 'expo-haptics'

import {  BrandedFooter } from '../design'
import { FeaturedSessionCard } from '@/components/sessions/v2/SessionCards'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SPACING, SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { MatchSession } from '@/lib/homeFeed'

interface RegistrationSuccessViewProps {
  session: any
  onBackHome?: () => void
  status?: string | null
}

export function RegistrationSuccessView({ session, onBackHome, status }: RegistrationSuccessViewProps) {
  const theme = useAppTheme()
  const { t } = useTranslation()
  const isWaiting = status === 'waiting'
  
  // Calculate enrolled count and waitlist position
  const enrolledCount = session.session_players?.filter((p: any) => p.status === 'confirmed' || p.status === 'checked_in').length || 0
  const maxPlayers = session.max_players || 4
  const waitlistPosition = isWaiting ? Math.max(1, enrolledCount - maxPlayers) : 0

  useEffect(() => {
    // Trigger success haptic on mount (Native only)
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
  }, [])

  const handleShare = async () => {
    try {
      const startTime = new Date(session.start_time || session.slot?.start_time || Date.now())
      const endTime = new Date(session.end_time || session.slot?.end_time || Date.now())
      const timeStr = `${startTime.getHours()}:${startTime.getMinutes().toString().padStart(2, '0')} - ${endTime.getHours()}:${endTime.getMinutes().toString().padStart(2, '0')}`

      const message = t('registration.share_message', {
        title: session.title || 'Kèo Pickleball',
        court: session.court_name || session.slot?.court?.name || 'Sân Pickleball',
        time: timeStr
      })
      await Share.share({
        message,
        url: `https://picklematch.vn/register/${session.id}`, // Mock URL
      })
    } catch (error) {
      console.error('Error sharing:', error)
    }
  }

  const handleAddToCalendar = () => {
    Alert.alert(t('registration.add_to_calendar_title'), t('registration.add_to_calendar_message'))
  }

  return (
    <ScrollView 
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ paddingBottom: 40, paddingTop: 20 }}
    >
      {/* 1. STATUS CARD */}
      {isWaiting ? (
        /* WAITLIST CARD */
        <View style={{
          backgroundColor: theme.surface,
          borderRadius: 16,
          borderWidth: 0.5,
          borderColor: theme.borderStrong,
          padding: 20,
          alignItems: 'center',
          gap: 10,
          marginHorizontal: 16,
          marginBottom: 20,
          ...SHADOW.sm
        }}>
          {/* Icon — amber */}
          <View style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: theme.warningContainer,
            borderWidth: 4, borderColor: theme.warningSoft,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 24 }}>🕐</Text>
          </View>

          {/* Title — amber */}
          <Text style={{
            fontFamily: SCREEN_FONTS.headlineItalic,
            fontSize: 24, color: theme.warning,
            lineHeight: 24, letterSpacing: -0.3,
            textAlign: 'center',
          }}>{t('registration.waitlist_title')}</Text>

          {/* Description */}
          <Text style={{
            fontFamily: SCREEN_FONTS.body,
            fontSize: 13, color: theme.textMuted,
            lineHeight: 20, textAlign: 'center',
            maxWidth: 280,
          }}>
            {t('registration.waitlist_desc')}
          </Text>

          {/* Waitlist position badge */}
          <View style={{
            backgroundColor: theme.warningContainer,
            borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10,
            width: '100%',
            flexDirection: 'row', alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: theme.warning, flexShrink: 0,
              }} />
              <Text style={{
                fontFamily: SCREEN_FONTS.label,
                fontSize: 12, fontWeight: '600', color: theme.warning,
              }}>{t('registration.waitlist_position')}</Text>
            </View>
            <Text style={{
              fontFamily: SCREEN_FONTS.headlineBlack,
              fontSize: 18, color: theme.warning,
            }}>#{waitlistPosition}</Text>
          </View>
        </View>
      ) : (
        /* SUCCESS CARD */
        <View style={{
          backgroundColor: theme.surface,
          borderRadius: 16,
          borderWidth: 0.5,
          borderColor: theme.successSoft,
          padding: 20,
          alignItems: 'center',
          gap: 10,
          marginHorizontal: 16,
          marginBottom: 20,
          ...SHADOW.sm
        }}>
          {/* Icon */}
          <View style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: theme.success,
            borderWidth: 4, borderColor: theme.successSoft,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 24, color: theme.primaryContrast }}>✓</Text>
          </View>

          {/* Title */}
          <Text style={{
            fontFamily: SCREEN_FONTS.headlineItalic,
            fontSize: 26, color: theme.success,
            lineHeight: 26, letterSpacing: -0.3,
            textAlign: 'center',
          }}>{t('registration.success_title')}</Text>

          {/* Description */}
          <Text style={{
            fontFamily: SCREEN_FONTS.body,
            fontSize: 13, color: theme.textMuted,
            lineHeight: 20, textAlign: 'center',
            maxWidth: 280,
          }}>
            {t('registration.success_desc')}
          </Text>

          {/* Confirm badge */}
          <View style={{
            backgroundColor: theme.successContainer,
            borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10,
            width: '100%',
            flexDirection: 'row', alignItems: 'center', gap: 8,
          }}>
            <View style={{
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: theme.success, flexShrink: 0,
            }} />
            <Text style={{
              fontFamily: SCREEN_FONTS.label,
              fontSize: 12, fontWeight: '600', color: theme.success,
            }}>
              {t('registration.success_count', { count: enrolledCount })}
            </Text>
          </View>
        </View>
      )}

      {/* 2. REGISTRATION CARD (Session Info) */}
      <View style={{ marginBottom: 24, marginHorizontal: 16 }}>
        <FeaturedSessionCard session={session} />
      </View>

      {/* 3. ACTION BUTTONS */}
      <View style={{
        flexDirection: 'row', gap: 8,
        marginHorizontal: 16,
        marginBottom: 20,
      }}>
        {/* Add to calendar — ghost gray */}
        <TouchableOpacity style={{
          flex: 1,
          backgroundColor: theme.surface,
          borderWidth: 1.5, borderColor: theme.borderStrong,
          borderRadius: 999, padding: 12,
          flexDirection: 'row',
          alignItems: 'center', justifyContent: 'center', gap: 6,
        }} onPress={handleAddToCalendar}>
          <Text style={{ fontSize: 14 }}>📅</Text>
          <Text style={{
            fontFamily: SCREEN_FONTS.label,
            fontSize: 13, fontWeight: '600', color: theme.text,
          }}>{t('registration.action_calendar')}</Text>
        </TouchableOpacity>

        {/* Share — teal primary */}
        <TouchableOpacity style={{
          flex: 1,
          backgroundColor: theme.primary,
          borderRadius: 999, padding: 12,
          flexDirection: 'row',
          alignItems: 'center', justifyContent: 'center', gap: 6,
        }} onPress={handleShare}>
          <Text style={{ fontSize: 14, color: theme.primaryContrast }}>⇪</Text>
          <Text style={{
            fontFamily: SCREEN_FONTS.bold,
            fontSize: 13, fontWeight: '700', color: theme.primaryContrast,
          }}>{t('registration.action_share')}</Text>
        </TouchableOpacity>
      </View>

      {/* 4. CLOSE HINT */}
      <Text style={{
        fontFamily: SCREEN_FONTS.body,
        fontSize: 11, color: theme.textSoft,
        textAlign: 'center',
        marginHorizontal: 16,
        marginBottom: 8,
      }}>
        {t('registration.close_hint')}
      </Text>

      <BrandedFooter />
    </ScrollView>
  )
}

const _styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: SPACING.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    ...SHADOW.sm,
  },
  title: {
    fontSize: 26,
    fontFamily: SCREEN_FONTS.headline,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: SCREEN_FONTS.body,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  ticketCard: {
    width: '100%',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    position: 'relative',
    overflow: 'visible',
    marginBottom: 40,
  },
  ticketContent: {
    padding: SPACING.xl,
  },
  ticketHeader: {
    fontSize: 13,
    letterSpacing: 1.5,
    marginBottom: 20,
    textAlign: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  infoText: {
    fontSize: 16,
    fontFamily: SCREEN_FONTS.headline,
  },
  addressText: {
    fontSize: 13,
    fontFamily: SCREEN_FONTS.body,
    marginTop: 2,
  },
  divider: {
    height: 1,
    width: '100%',
    marginVertical: 20,
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerItem: {
    flex: 1,
    alignItems: 'center',
  },
  verticalDivider: {
    width: 1,
    height: 40,
    opacity: 0.3,
  },
  footerLabel: {
    fontSize: 10,
    fontFamily: AppFontSet.label,
    marginBottom: 6,
    opacity: 0.7,
  },
  footerValue: {
    fontSize: 18,
    fontFamily: SCREEN_FONTS.headline,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.xs,
  },
  statusText: {
    fontSize: 11,
    fontFamily: SCREEN_FONTS.headline,
  },
  holeLeft: {
    position: 'absolute',
    left: -12,
    top: '65%',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 2,
  },
  holeRight: {
    position: 'absolute',
    right: -12,
    top: '65%',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 2,
  },
  actions: {
    width: '100%',
    gap: 12,
  },
  primaryAction: {
    width: '100%',
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 12,
  },
})
