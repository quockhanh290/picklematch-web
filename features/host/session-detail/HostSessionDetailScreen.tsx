import React, { useState, useMemo } from 'react'
import * as Linking from 'expo-linking'
import { Platform, Pressable, RefreshControl, ScrollView, Share, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Trophy, CheckCircle2, Sparkles, BarChart2 } from 'lucide-react-native'
import { Alert } from 'react-native'
import { supabase } from '@/lib/supabase'
import { STRINGS } from '@/constants/strings'

import { AppDialog, type AppDialogConfig, SecondaryNavbar } from '@/components/design'
import { useAppTheme } from '@/lib/theme-context'
import { FeaturedSessionCard } from '@/components/sessions/v2/SessionCards'
import { getStatusLabel, type MatchSession } from '@/lib/homeFeed'
import { HostRosterSection } from './HostRosterSection'
import { SessionActionButtons } from '@/components/session/SessionActionButtons'
import { SCREEN_FONTS } from '@/constants/typography'
import { SPACING, RADIUS, SHADOW } from '@/constants/screenLayout'
import { formatTimeRange, buildArrangementPlayers } from '@/lib/sessionDetail'
import { 
  getEloBandForSessionRange,
  getShortLabelForLevelId,
  type EloLevelId,
  type LegacySkillLabel,
} from '@/lib/eloSystem'
import { getSessionSkillLabel } from '@/lib/skillAssessment'

import type { SessionMatch } from '@/hooks/useSessionDetail'
import { BrandedFooter } from '@/components/design/BrandedFooter'
import { prewarmSuggestFunction, syncLiveRosterFromSessionPlayers } from './next-round-v2/api'

interface HostSessionDetailScreenProps {
  id: string
  session: any
  viewerPlayer: any
  refreshing: boolean
  onRefresh: () => Promise<void>
  isHost: boolean
  matches: SessionMatch[]
}

export function HostSessionDetailScreen({
  id,
  session,
  viewerPlayer,
  refreshing,
  onRefresh,
  isHost,
  matches,
}: HostSessionDetailScreenProps) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)
  const [isCheckInMode, setIsCheckInMode] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isProcessingCheckIn, setIsProcessingCheckIn] = useState(false)


  const now = new Date().getTime()
  const startTime = new Date(session.slot?.start_time ?? 0).getTime()
  const oneHour = 3600000
  // For testing: allow check-in anytime if not completed
  const canCheckIn = !session.check_in_completed
  const isCheckInCompleted = session.check_in_completed === true
  const parseRobustDate = (d: any) => {
    let str = String(d).trim()
    // Remove leading non-digits (e.g., "Thứ Sáu, 08/05/2026" -> "08/05/2026")
    str = str.replace(/^[^\d]+/, '')
    
    // Try standard parsing
    let t = new Date(str).getTime()
    if (!isNaN(t)) return t

    // Try Vietnamese/Custom DD-MM-YYYY
    str = str.replace(/\//g, '-')
    const dateMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(.*)/)
    if (dateMatch) {
      str = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}${dateMatch[4]}`
      str = str.replace(' ', 'T')
      t = new Date(str).getTime()
      if (!isNaN(t)) return t
    }
    return 0
  }
  const startTs = parseRobustDate(session.slot?.start_time)
  const isWayPastStart = startTs > 0 && (Date.now() - startTs) > (12 * 3600000)
  const isAfterEnd = parseRobustDate(session.slot?.end_time) <= Date.now() || ['completed', 'finished', 'archived', 'done', 'pending_results', 'pending_completion'].includes(session.status) || isWayPastStart
  const confirmedPlayerCount = (session?.session_players ?? []).filter((p: any) => p.status === 'confirmed').length
  const HostDetails = session.owner_sessions?.[0] || session.owner_sessions || {}
  const matchFormat = HostDetails.match_format || 'doubles'
  const minPlayers = session?.min_players || (matchFormat === 'doubles' ? 4 : 2)
  const isInvalidPlayerCount = !session?.is_unlimited && confirmedPlayerCount < minPlayers && isAfterEnd && !session.check_in_completed && matches.length === 0
  const isCancelled = session.status === 'cancelled' || session.status === 'failed_to_fill' || session.court_booking_status === 'cancelled' || session.status === 'cancelled_no_players' || isInvalidPlayerCount

  const sessionSkillLabel = getSessionSkillLabel(session.elo_min, session.elo_max)
  const processedPlayers = buildArrangementPlayers({ ...session, owner_sessions: HostDetails })

  const targetRounds = Number(HostDetails.target_rounds ?? 0)
  const completedRoundCount = useMemo(() => {
    const rotations = new Set(
      matches
        .filter(m => m.status === 'finished' && m.players_snapshot?.rotation != null)
        .map(m => m.players_snapshot!.rotation!)
    )
    return rotations.size
  }, [matches])


  const handleCompleteCheckIn = async () => {
    // Message for confirmation
    const message = STRINGS.host_flow.check_in.transition_confirm
    
    const confirmAction = async () => {
      try {
        setIsProcessingCheckIn(true)
        console.log('[CheckIn] Starting confirmAction for session:', id)
        
        // 1. Mark session as completed and lock it
        console.log('[CheckIn] Calling complete_session_check_in RPC...')
        const { error: rpcError } = await supabase.rpc('complete_session_check_in', { p_session_id: id })
        if (rpcError) {
          console.error('[CheckIn] RPC Error:', rpcError)
          throw rpcError
        }
        console.log('[CheckIn] RPC Success')
        await syncLiveRosterFromSessionPlayers(id)
        console.log('[CheckIn] Roster sync success')

        onRefresh()
        setIsCheckInMode(false)
      } catch (err: any) {
        Alert.alert(STRINGS.common.error, err.message || 'Không thể hoàn tất check-in')
      } finally {
        setIsProcessingCheckIn(false)
      }
    }

    setDialogConfig({
      title: STRINGS.host_flow.check_in.complete,
      message,
      actions: [
        { label: STRINGS.common.later, tone: 'secondary', onPress: () => setDialogConfig(null) },
        { label: STRINGS.common.confirm, tone: 'primary', onPress: confirmAction }
      ]
    })
  }

  const handleCancelSession = async () => {
    console.log('[CancelSession] Button pressed for session:', id)
    const confirmMessage = 'Bạn có chắc chắn muốn hủy kèo này không? Hành động này không thể hoàn tác.'
    
    const proceedWithCancellation = async () => {
      setIsCancelling(true)
      try {
        console.log('[CancelSession] Updating session status to cancelled...')
        const { error } = await supabase
          .from('sessions')
          .update({ status: 'cancelled' })
          .eq('id', id)
        
        if (error) throw error
        
        console.log('[CancelSession] Success')
        if (Platform.OS === 'web') {
          window.alert('Kèo đã được hủy thành công.')
        } else {
          Alert.alert('Thành công', 'Kèo đã được hủy.')
        }
        router.back()
      } catch (err: any) {
        console.error('[CancelSession] Error:', err)
        const errMsg = err.message || 'Không thể hủy kèo'
        if (Platform.OS === 'web') {
          window.alert('Lỗi: ' + errMsg)
        } else {
          Alert.alert('Lỗi', errMsg)
        }
      } finally {
        setIsCancelling(false)
      }
    }

    if (Platform.OS === 'web') {
      if (window.confirm(confirmMessage)) {
        await proceedWithCancellation()
      }
    } else {
      Alert.alert(
        'Xác nhận hủy kèo',
        confirmMessage,
        [
          { text: 'Bỏ qua', style: 'cancel' },
          { text: 'Hủy kèo', style: 'destructive', onPress: proceedWithCancellation }
        ]
      )
    }
  }
  const subCourts = session.sub_court_numbers || HostDetails.sub_court_numbers || []

  const activeMatchesCount = matches.filter(m => m.status === 'playing').length

  const FORMAT_LABELS: Record<string, string> = {
    social: 'SOCIAL FUN',
    round_robin: 'ROUND ROBIN',
    open_play: 'OPEN PLAY',
  }

  const formatPrice = (pricePerPerson: number) => {
    if (pricePerPerson <= 0) return 'Miễn phí'
    return `${Math.round(pricePerPerson / 1000)}K`
  }

  // Removed previewMatch as FeaturedSessionCard now parses the raw session directly

  const handleShare = async () => {
    const url = Linking.createURL(`/register/${id}`)
    const shareMessage = `Mời bạn tham gia kèo ${FORMAT_LABELS[HostDetails.format_type || 'social']} tại ${session.slot.court.name}!\n\nĐăng ký tham gia ngay tại đây: ${url}`

    const copyLink = async () => {
      if (Platform.OS === 'web') {
        try {
          if (globalThis.navigator?.clipboard?.writeText) {
            await globalThis.navigator.clipboard.writeText(url)
            setDialogConfig({
              title: 'Đã sao chép link',
              message: 'Link đăng ký đã được copy vào clipboard.',
              actions: [{ label: 'OK' }],
            })
            return
          }
        } catch (e) {
          console.warn('Clipboard write block, showing fallback dialog');
        }
        
        // Fallback dialog
        setDialogConfig({
          title: 'Sao chép link đăng ký',
          message: `Vui lòng bôi đen và copy link sau:\n\n${url}`,
          actions: [{ label: 'OK' }],
        })
      }
    }

    try {
      if (Platform.OS === 'web') {
        await copyLink()
        return
      }

      await Share.share({ message: shareMessage })
    } catch (error) {
      console.warn('[HostSessionDetail] Failed to share:', error)
      try {
        await copyLink()
      } catch {}
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }} testID="host-session-detail-screen">
      <SecondaryNavbar
        title="CHI TIẾT KÈO CHỦ SÂN"
        onBackPress={() => router.replace('/host/dashboard')}
        rightSlot={
          <Pressable onPress={handleShare} style={{ marginRight: 8 }}>
            <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline }}>Chia sẻ</Text>
          </Pressable>
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        contentContainerStyle={{
          paddingBottom: 48 + insets.bottom,
          paddingHorizontal: SPACING.xl,
          paddingTop: 12,
        }}
      >
        {__DEV__ && (
          <TouchableOpacity 
            onPress={async () => {
              try {
                const res1 = await supabase.from('sessions').update({ status: 'open', check_in_completed: false }).eq('id', id)
                if (res1.error) throw res1.error
                const res2 = await supabase.from('session_players').update({ team_no: null, check_in_status: 'pending', status: 'confirmed' }).eq('session_id', id).neq('status', 'cancelled')
                if (res2.error) throw res2.error
                const res3 = await supabase.from('session_matches').delete().eq('session_id', id)
                if (res3.error) throw res3.error
                onRefresh()
                Alert.alert('Thành công', 'Đã reset trạng thái kèo và xóa toàn bộ lịch sử trận để test.')
              } catch (e: any) {
                console.error(e)
                Alert.alert('Lỗi', e.message || 'Không thể reset')
              }
            }}
            style={{ 
              alignSelf: 'flex-end', 
              paddingHorizontal: 8, 
              paddingVertical: 4, 
              backgroundColor: '#fee2e2', 
              borderRadius: 4,
              borderWidth: 1,
              borderColor: '#fecaca'
            }}
          >
            <Text style={{ fontSize: 10, color: '#dc2626', fontWeight: 'bold' }}>RESET TEST</Text>
          </TouchableOpacity>
        )}

        <FeaturedSessionCard
          session={session as any}
          isHost={isHost}
          forcePrimaryColor={true}
        />

        {/* Format Selector REMOVED */}


        {canCheckIn && !isCheckInCompleted && !isCancelled && !isAfterEnd && (
          <View style={{ marginTop: 12 }}>
            {!isCheckInMode ? (
              <TouchableOpacity
                onPress={() => setIsCheckInMode(true)}
                style={{
                  backgroundColor: theme.primary,
                  paddingVertical: 16,
                  borderRadius: RADIUS.xl,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 10,
                  ...SHADOW.md
                }}
              >
                <CheckCircle2 size={20} color={theme.onPrimary} />
                <Text style={{ color: theme.onPrimary, fontSize: 16, fontFamily: SCREEN_FONTS.headline }}>{STRINGS.host_flow.check_in.start}</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity 
                  onPress={handleCompleteCheckIn}
                  disabled={isProcessingCheckIn}
                  style={{ 
                    flex: 2,
                    backgroundColor: theme.primary,
                    paddingVertical: 16,
                    borderRadius: RADIUS.xl,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    gap: 10,
                    opacity: isProcessingCheckIn ? 0.7 : 1,
                    ...SHADOW.md
                  }}
                >
                  {isProcessingCheckIn ? (
                    <ActivityIndicator color={theme.onPrimary} />
                  ) : (
                    <>
                      <CheckCircle2 size={20} color={theme.onPrimary} />
                      <Text style={{ color: theme.onPrimary, fontSize: 16, fontFamily: SCREEN_FONTS.headline }}>{STRINGS.host_flow.check_in.complete}</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity 
                  onPress={() => setIsCheckInMode(false)}
                  disabled={isProcessingCheckIn}
                  style={{ 
                    flex: 1,
                    backgroundColor: theme.surface,
                    borderWidth: 1,
                    borderColor: theme.outlineVariant,
                    paddingVertical: 16,
                    borderRadius: RADIUS.xl,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: isProcessingCheckIn ? 0.7 : 1,
                    ...SHADOW.sm
                  }}
                >
                  <Text style={{ color: theme.onSurface, fontSize: 16, fontFamily: SCREEN_FONTS.headline, fontWeight: '700' }}>
                    {STRINGS.common.cancel || 'Hủy'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {isCheckInCompleted && !isCancelled && !isAfterEnd && (
          <View style={{ gap: 10, marginTop: 12 }}>
            <TouchableOpacity 
              onPress={() => { prewarmSuggestFunction(id); router.push(`/host/session/${id}/next-round` as any) }}
              style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                justifyContent: 'center',
                gap: 8, 
                backgroundColor: theme.primary, 
                paddingVertical: 12, 
                borderRadius: RADIUS.lg,
                borderWidth: 1,
                borderColor: theme.primary
              }}
            >
              <Trophy size={18} color={theme.onPrimary} />
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.onPrimary }}>QUẢN LÝ TRẬN</Text>
              {activeMatchesCount > 0 && (
                <View style={{ backgroundColor: '#fff', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: theme.primary, fontSize: 10, fontFamily: SCREEN_FONTS.headline }}>{activeMatchesCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}
        {(!isCheckInCompleted || isCancelled) && (
          <HostRosterSection
            players={processedPlayers}
            maxPlayers={session.max_players}
            sessionStatus={session.status}
            hostId={session.host.id}
            hideEmptySlots={false}
            requireApproval={session.require_approval || session.owner_sessions?.require_approval}
            sessionId={id}
            onUpdated={onRefresh}
            checkInCompleted={isCheckInCompleted}
            isCheckInMode={isCheckInMode}
            startTime={session.slot?.start_time}
            isHost={isHost}
            isAfterEnd={isAfterEnd}
          />
        )}

        <View style={{ marginTop: 24, gap: 10 }}>
          {isAfterEnd ? (
            <>
              <View style={{
                width: '100%',
                minHeight: 52,
                borderRadius: RADIUS.lg,
                backgroundColor: theme.surfaceContainerHigh,
                borderWidth: 1,
                borderColor: theme.outlineVariant,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.onSurfaceVariant }}>KÈO ĐÃ KẾT THÚC</Text>
              </View>
              <TouchableOpacity
              onPress={() => router.push(`/host/session/${id}/next-round?report=1` as any)}
              activeOpacity={0.84}
              style={{
                width: '100%',
                minHeight: 52,
                backgroundColor: theme.primary,
                borderRadius: RADIUS.lg,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <BarChart2 size={18} color={theme.onPrimary} />
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 15, color: theme.onPrimary }}>XEM BÁO CÁO</Text>

                {targetRounds > 0 && (
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onPrimary, opacity: 0.75 }}>
                    {completedRoundCount >= targetRounds
                      ? `Đã hoàn thành ${completedRoundCount} vòng`
                      : `Đã chơi ${completedRoundCount}/${targetRounds} vòng`}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
            </>
          ) : (
            <SessionActionButtons
              id={id}
              session={session}
              isHost={isHost}
              hasJoined={false}
              isAfterEnd={isAfterEnd}
              isDuringMatch={parseRobustDate(session.slot?.start_time) <= Date.now() && !isAfterEnd}
              isCancelled={isCancelled}
              viewerSessionPlayer={null}
              hostPrimaryMode="edit"
              hostPrimaryDisabled={false}
              hostActionBusy={false}
              savingArrangement={false}
              leaving={isCancelling}
              onSaveArrangement={() => {}}
              leaveSession={handleCancelSession}
              checkInCompleted={isCheckInCompleted}
              hideArrangementCta={true}
              hideInputResult={false}
              matchesCount={matches.length}
            />
          )}
        </View>
        <BrandedFooter />
      </ScrollView>

      <AppDialog visible={Boolean(dialogConfig)} config={dialogConfig} onClose={() => setDialogConfig(null)} />
    </View>
  )
}
