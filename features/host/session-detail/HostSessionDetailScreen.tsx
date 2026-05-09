import React, { useState } from 'react'
import * as Linking from 'expo-linking'
import { Platform, Pressable, RefreshControl, ScrollView, Share, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Trophy, LayoutDashboard, CheckCircle2, Check, AlertTriangle } from 'lucide-react-native'
import { Alert } from 'react-native'
import { supabase } from '@/lib/supabase'

import { AppDialog, type AppDialogConfig, SecondaryNavbar } from '@/components/design'
import { useAppTheme } from '@/lib/theme-context'
import { MatchSessionCard } from '@/components/home/MatchSessionCard'
import { getStatusLabel, type MatchSession } from '@/lib/homeFeed'
import { HostRosterSection } from './HostRosterSection'
import { SessionActionButtons } from '@/components/session/SessionActionButtons'
import { SCREEN_FONTS } from '@/constants/typography'
import { SPACING, RADIUS, SHADOW } from '@/constants/screenLayout'
import { formatTimeRange, buildArrangementPlayers } from '@/lib/sessionDetail'
import { getEloBandForSessionRange } from '@/lib/eloSystem'
import { getSessionSkillLabel } from '@/lib/skillAssessment'

import type { SessionMatch } from '@/hooks/useSessionDetail'
import { BrandedFooter } from '@/components/design/BrandedFooter'

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



  const now = new Date().getTime()
  const startTime = new Date(session.slot.start_time).getTime()
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
  const startTs = parseRobustDate(session.slot.start_time)
  const isWayPastStart = startTs > 0 && (Date.now() - startTs) > (12 * 3600000)
  const isAfterEnd = parseRobustDate(session.slot.end_time) <= Date.now() || ['completed', 'finished', 'archived', 'done', 'pending_results', 'pending_completion'].includes(session.status) || isWayPastStart
  const confirmedPlayerCount = (session?.session_players ?? []).filter((p: any) => p.status === 'confirmed').length
  const minPlayers = session?.min_players || 2
  const isInvalidPlayerCount = !session?.is_unlimited && confirmedPlayerCount < minPlayers && isAfterEnd
  const isCancelled = session.status === 'cancelled' || session.status === 'failed_to_fill' || session.court_booking_status === 'cancelled' || session.status === 'cancelled_no_players' || isInvalidPlayerCount

  const sessionSkillLabel = getSessionSkillLabel(session.elo_min, session.elo_max)
  const HostDetails = session.owner_sessions?.[0] || session.owner_sessions || {}
  const processedPlayers = buildArrangementPlayers({ ...session, owner_sessions: HostDetails })

  const handleCompleteCheckIn = async () => {
    // Message for confirmation
    const message = 'Sau khi hoàn tất Check-in, hệ thống sẽ tự động sắp xếp đội cân bằng dựa trên trình độ. Tiếp tục?'
    
    const confirmAction = async () => {
      try {
        console.log('[CheckIn] Starting confirmAction for session:', id)
        
        // 1. Mark session as completed and lock it
        console.log('[CheckIn] Calling complete_session_check_in RPC...')
        const { error: rpcError } = await supabase.rpc('complete_session_check_in', { p_session_id: id })
        if (rpcError) {
          console.error('[CheckIn] RPC Error:', rpcError)
          throw rpcError
        }
        console.log('[CheckIn] RPC Success')

        // 2. Perform Auto-Arrangement for "Present" players
        console.log('[CheckIn] Fetching present players...')
        const { data: playersData, error: fetchError } = await supabase
          .from('session_players')
          .select('player_id, check_in_status')
          .eq('session_id', id)
          .eq('status', 'confirmed')

        if (fetchError) {
          console.error('[CheckIn] Fetch Error:', fetchError)
          throw fetchError
        }

        const presentPlayerIds = (playersData ?? [])
          .filter(sp => sp.check_in_status === 'present')
          .map(sp => sp.player_id)

        console.log('[CheckIn] Present players count:', presentPlayerIds.length)

        if (presentPlayerIds.length >= 2) {
          console.log('[CheckIn] Applying system auto-balance logic...')
          const presentPlayers = processedPlayers
            .filter(p => presentPlayerIds.includes(p.id))
            .sort((a, b) => {
              const valA = Number(a.pvna || (a.elo / 100) || 0)
              const valB = Number(b.pvna || (b.elo / 100) || 0)
              return valB - valA
            })

          const numTeams = Math.max(2, Math.ceil(presentPlayers.length / 2))
          const playersPerTeam = 2 // We want 2 people per team
          
          const assignments: { player_id: string, team_no: number }[] = []
          const result: any[] = []
          const used = new Set()
          
          let left = 0
          let right = presentPlayers.length - 1
          let teamIdx = 1

          while (result.length < presentPlayers.length) {
            for (let i = 0; i < playersPerTeam; i++) {
              if (result.length >= presentPlayers.length) break
              
              let pickedIdx = -1
              if (i % 2 === 0) {
                while (left < presentPlayers.length && used.has(presentPlayers[left].id)) left++
                if (left < presentPlayers.length) pickedIdx = left
              } else {
                while (right >= 0 && used.has(presentPlayers[right].id)) right--
                if (right >= 0 && right >= left) pickedIdx = right
              }

              if (pickedIdx !== -1) {
                const p = presentPlayers[pickedIdx]
                assignments.push({ player_id: p.id, team_no: teamIdx })
                result.push(p)
                used.add(p.id)
              }
            }
            if (teamIdx < numTeams) teamIdx++
            else break // Safety
          }

          console.log('[CheckIn] Saving system-balanced pairs:', assignments)
          const { error: saveError } = await supabase.rpc('save_session_teams', {
            p_session_id: id,
            p_assignments: assignments
          })
          if (saveError) {
            console.error('[CheckIn] Save Teams Error:', saveError)
            throw saveError
          }
          console.log('[CheckIn] Teams saved successfully')
        }
        
        setIsCheckInMode(false)
        onRefresh()
        console.log('[CheckIn] All steps completed')
      } catch (err: any) {
        console.error('[CheckIn] Caught Exception:', err)
        const errMsg = err?.message || 'Không thể hoàn tất check-in hoặc tự động chia đội.'
        if (Platform.OS === 'web') {
          window.alert('Lỗi: ' + errMsg)
        } else {
          Alert.alert('Lỗi', errMsg)
        }
      }
    }

    if (Platform.OS === 'web') {
      if (window.confirm(message)) await confirmAction()
    } else {
      Alert.alert('Xác nhận hoàn tất', message, [
        { text: 'QUAY LẠI', style: 'cancel' },
        { text: 'XÁC NHẬN', onPress: confirmAction }
      ])
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

  const previewMatch: MatchSession = {
    id: session.id,
    title: session.title || 'Kèo chủ sân',
    bookingId: session.booking_reference || 'Host',
    courtName: session.slot.court.name,
    courtId: session.slot.court.id,
    address: session.slot.court.city ? `${session.slot.court.address}, ${session.slot.court.city}` : session.slot.court.address,
    matchScore: 100,
    matchHint: FORMAT_LABELS[HostDetails.format_type || 'social'],
    skillLabel: sessionSkillLabel,
    timeLabel: formatTimeRange(session.slot.start_time, session.slot.end_time),
    priceLabel: formatPrice(Number(HostDetails.total_cost ?? session.total_cost ?? 0)),
    openSlotsLabel: `Đã có ${session.session_players?.length || 0} người tham gia`,
    statusLabel: isAfterEnd ? 'KẾT THÚC' : getStatusLabel(session.court_booking_status, session.status),
    courtBookingConfirmed: session.court_booking_status === 'confirmed',
    isBooked: true,
    isRanked: session.is_ranked,
    requireApproval: HostDetails.require_approval || session.require_approval,
    activePlayers: session.session_players?.length || 0,
    maxPlayers: session.max_players,
    levelId: getEloBandForSessionRange(session.elo_min, session.elo_max).levelId,
    host: session.host,
    players: session.session_players || [],
    urgent: false,
    joined: false,
    subCourtLabel: subCourts.length > 0 ? `Sân ${subCourts.join(', ')}` : '',
  } as any

  const handleShare = async () => {
    const url = Linking.createURL(`/register/${id}`)
    const shareMessage = `Mời bạn tham gia kèo ${FORMAT_LABELS[HostDetails.format_type || 'social']} tại ${session.slot.court.name}!\n\nĐăng ký tham gia ngay tại đây: ${url}`

    const copyLink = async () => {
      if (Platform.OS === 'web' && globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(url)
        setDialogConfig({
          title: 'Đã sao chép link',
          message: 'Link đăng ký đã được copy vào clipboard.',
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
    <View style={{ flex: 1, backgroundColor: theme.background }}>
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
        {/* DEBUG RESET BUTTON - ONLY FOR TESTING */}
        <TouchableOpacity 
          onPress={async () => {
            try {
              await supabase.from('sessions').update({ status: 'open', check_in_completed: false }).eq('id', id)
              await supabase.from('session_players').update({ team_no: 0, check_in_status: 'pending' }).eq('session_id', id)
              onRefresh()
              Alert.alert('Thành công', 'Đã reset trạng thái kèo để test.')
            } catch (e) {
              console.error(e)
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

        <MatchSessionCard
          item={previewMatch}
          variant="standard"
          actionLabel={isHost ? "QUẢN LÝ KÈO" : "THAM GIA NGAY"}
          showFullAddress={true}
          isHostDetail
          fullCourtName={true}
        />

        {/* Format Selector REMOVED */}

        {session.is_ranked && !isAfterEnd && (
          <TouchableOpacity 
            onPress={() => router.push(`/host/session/${id}/recap` as any)}
            style={{ 
              backgroundColor: '#FAECE7',
              paddingVertical: 14,
              borderRadius: RADIUS.lg,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              marginTop: 12,
              borderWidth: 1,
              borderColor: '#993C1D20',
              ...SHADOW.sm
            }}
          >
            <Trophy size={18} color="#993C1D" />
            <Text style={{ color: '#993C1D', fontSize: 14, fontFamily: SCREEN_FONTS.headline, fontWeight: 'bold' }}>XEM BẢNG XẾP HẠNG</Text>
          </TouchableOpacity>
        )}

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
                <Text style={{ color: theme.onPrimary, fontSize: 16, fontFamily: SCREEN_FONTS.headline }}>BẮT ĐẦU ĐIỂM DANH</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity 
                  onPress={handleCompleteCheckIn}
                  style={{ 
                    flex: 2,
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
                  <Text style={{ color: theme.onPrimary, fontSize: 16, fontFamily: SCREEN_FONTS.headline }}>HOÀN TẤT ĐIỂM DANH</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  onPress={() => setIsCheckInMode(false)}
                  style={{ 
                    flex: 1,
                    backgroundColor: theme.dangerStrong,
                    paddingVertical: 16,
                    borderRadius: RADIUS.xl,
                    alignItems: 'center',
                    justifyContent: 'center',
                    ...SHADOW.sm
                  }}
                >
                  <Text style={{ color: 'white', fontSize: 16, fontFamily: SCREEN_FONTS.headline, fontWeight: '700' }}>HỦY</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {isCheckInCompleted && !isCancelled && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <TouchableOpacity 
              onPress={() => router.push(`/host/session/${id}/matches` as any)}
              style={{ 
                flex: 1,
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

            <TouchableOpacity 
              onPress={() => router.push(`/host/session/${id}/arrangement` as any)}
              style={{ 
                flex: 1,
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
              <LayoutDashboard size={18} color={theme.onPrimary} />
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: theme.onPrimary }}>SẮP ĐỘI</Text>
            </TouchableOpacity>
          </View>
        )}

        <HostRosterSection
          players={processedPlayers}
          maxPlayers={session.max_players}
          sessionStatus={session.status}
          hostId={session.host.id}
          hideEmptySlots={false}
          requireApproval={session.require_approval || session.owner_sessions?.require_approval}
          sessionId={id}
          onUpdated={onRefresh}
          onArrangementPress={() => router.push(`/host/session/${id}/arrangement` as any)}
          checkInCompleted={isCheckInCompleted}
          isCheckInMode={isCheckInMode}
          startTime={session.slot.start_time}
        />

        {!isCheckInCompleted && (
          <View style={{ marginTop: 24 }}>
            <SessionActionButtons
              id={id}
              session={session}
              isHost={isHost}
              hasJoined={false}
              isAfterEnd={isAfterEnd}
              isDuringMatch={parseRobustDate(session.slot.start_time) <= Date.now() && !isAfterEnd}
              isCancelled={isCancelled}
              isFinalized={['completed', 'finished', 'archived', 'done'].includes(session.status)}
              isAwaitingResult={isAfterEnd && session.is_ranked && !['completed', 'finished', 'archived', 'done'].includes(session.status)}
              viewerSessionPlayer={null}
              hostPrimaryMode="edit"
              hostPrimaryDisabled={false}
              hostActionBusy={false}
              savingArrangement={false}
              leaving={false}
              onSaveArrangement={() => {}}
              leaveSession={() => {}}
              editPathname="/host/create-session"
              onArrangementPress={() => setShowArrangement(true)}
              checkInCompleted={isCheckInCompleted}
              hideInputResult={false}
              confirmedPlayerCount={confirmedPlayerCount}
              maxPlayers={session.max_players}
              isInvalidPlayerCount={isInvalidPlayerCount}
            />
          </View>
        )}
        <BrandedFooter />
      </ScrollView>

      <AppDialog visible={Boolean(dialogConfig)} config={dialogConfig} onClose={() => setDialogConfig(null)} />
    </View>
  )
}
