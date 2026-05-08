import React, { useEffect } from 'react'
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
import { MatchSessionCard } from '../home/MatchSessionCard'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SPACING, SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { MatchSession } from '@/lib/homeFeed'

interface RegistrationSuccessViewProps {
  session: MatchSession
  onBackHome?: () => void
  status?: string | null
}

export function RegistrationSuccessView({ session, onBackHome, status }: RegistrationSuccessViewProps) {
  const theme = useAppTheme()
  const isWaiting = status === 'waiting'
  
  // Calculate enrolled count and waitlist position
  const enrolledCount = session.activePlayers || session.players?.length || 0
  const maxPlayers = session.maxPlayers || 4
  const waitlistPosition = isWaiting ? Math.max(1, enrolledCount - maxPlayers) : 0

  useEffect(() => {
    // Trigger success haptic on mount (Native only)
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
  }, [])

  const handleShare = async () => {
    try {
      const message = `Mình vừa đăng ký tham gia kèo Pickleball: ${session.title}\n📍 Địa điểm: ${session.courtName}\n🕒 Thời gian: ${session.timeLabel}\nCùng tham gia với mình nhé!`
      await Share.share({
        message,
        url: `https://picklematch.vn/register/${session.id}`, // Mock URL
      })
    } catch (error) {
      console.error('Error sharing:', error)
    }
  }

  const handleAddToCalendar = () => {
    Alert.alert('Tính năng đang phát triển', 'Chúng tôi sẽ sớm hỗ trợ thêm lịch thi đấu vào ứng dụng của bạn.')
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
          backgroundColor: 'white',
          borderRadius: 16,
          borderWidth: 0.5,
          borderColor: '#E5E3DC',
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
            backgroundColor: '#FAEEDA',
            borderWidth: 4, borderColor: '#F0D5A8',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 24 }}>🕐</Text>
          </View>

          {/* Title — amber */}
          <Text style={{
            fontFamily: SCREEN_FONTS.headlineItalic,
            fontSize: 24, color: '#854F0B',
            lineHeight: 24, letterSpacing: -0.3,
            textAlign: 'center',
          }}>Bạn đang ở danh sách chờ</Text>

          {/* Description */}
          <Text style={{
            fontFamily: SCREEN_FONTS.body,
            fontSize: 13, color: '#7A8884',
            lineHeight: 20, textAlign: 'center',
            maxWidth: 280,
          }}>
            Hiện kèo đã đủ người. Bạn sẽ được tự động đón lên nếu có thành viên khác hủy tham gia.
          </Text>

          {/* Waitlist position badge */}
          <View style={{
            backgroundColor: '#FAEEDA',
            borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10,
            width: '100%',
            flexDirection: 'row', alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: '#EF9F27', flexShrink: 0,
              }} />
              <Text style={{
                fontFamily: SCREEN_FONTS.label,
                fontSize: 12, fontWeight: '600', color: '#854F0B',
              }}>Vị trí của bạn trong hàng chờ</Text>
            </View>
            <Text style={{
              fontFamily: SCREEN_FONTS.headlineBlack,
              fontSize: 18, color: '#854F0B',
            }}>#{waitlistPosition}</Text>
          </View>
        </View>
      ) : (
        /* SUCCESS CARD */
        <View style={{
          backgroundColor: 'white',
          borderRadius: 16,
          borderWidth: 0.5,
          borderColor: '#C5DDD3',
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
            backgroundColor: '#0F6E56',
            borderWidth: 4, borderColor: '#C5DDD3',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 24, color: 'white' }}>✓</Text>
          </View>

          {/* Title */}
          <Text style={{
            fontFamily: SCREEN_FONTS.headlineItalic,
            fontSize: 26, color: '#0F6E56',
            lineHeight: 26, letterSpacing: -0.3,
            textAlign: 'center',
          }}>Đăng ký thành công!</Text>

          {/* Description */}
          <Text style={{
            fontFamily: SCREEN_FONTS.body,
            fontSize: 13, color: '#7A8884',
            lineHeight: 20, textAlign: 'center',
            maxWidth: 280,
          }}>
            Bạn đã có tên trong danh sách tham gia chính thức. Hẹn gặp bạn tại sân!
          </Text>

          {/* Confirm badge */}
          <View style={{
            backgroundColor: '#E1F5EE',
            borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10,
            width: '100%',
            flexDirection: 'row', alignItems: 'center', gap: 8,
          }}>
            <View style={{
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: '#0F6E56', flexShrink: 0,
            }} />
            <Text style={{
              fontFamily: SCREEN_FONTS.label,
              fontSize: 12, fontWeight: '600', color: '#0F6E56',
            }}>
              Bạn là người chơi thứ {enrolledCount} trong kèo này
            </Text>
          </View>
        </View>
      )}

      {/* 2. REGISTRATION CARD (Session Info) */}
      <View style={{ marginBottom: 24, marginHorizontal: 16 }}>
        <MatchSessionCard 
          item={session} 
          variant="standard" 
          showFullAddress 
          isOwnerDetail 
          isPreview={false} 
          fullCourtName={true}
        />
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
          backgroundColor: 'white',
          borderWidth: 1.5, borderColor: '#E5E3DC',
          borderRadius: 999, padding: 12,
          flexDirection: 'row',
          alignItems: 'center', justifyContent: 'center', gap: 6,
        }} onPress={handleAddToCalendar}>
          <Text style={{ fontSize: 14 }}>📅</Text>
          <Text style={{
            fontFamily: SCREEN_FONTS.label,
            fontSize: 13, fontWeight: '600', color: '#1A2E2A',
          }}>Thêm vào lịch</Text>
        </TouchableOpacity>

        {/* Share — teal primary */}
        <TouchableOpacity style={{
          flex: 1,
          backgroundColor: '#0F6E56',
          borderRadius: 999, padding: 12,
          flexDirection: 'row',
          alignItems: 'center', justifyContent: 'center', gap: 6,
        }} onPress={handleShare}>
          <Text style={{ fontSize: 14, color: 'white' }}>⇪</Text>
          <Text style={{
            fontFamily: SCREEN_FONTS.bold,
            fontSize: 13, fontWeight: '700', color: 'white',
          }}>Chia sẻ</Text>
        </TouchableOpacity>
      </View>

      {/* 4. CLOSE HINT */}
      <Text style={{
        fontFamily: SCREEN_FONTS.body,
        fontSize: 11, color: '#B4B2A9',
        textAlign: 'center',
        marginHorizontal: 16,
        marginBottom: 8,
      }}>
        Bạn có thể đóng cửa sổ này
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
