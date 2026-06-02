import { AppDialog, type AppDialogConfig, SecondaryNavbar } from '@/components/design'
import { SessionMetaCard } from '@/components/session/SessionMetaCard'
import { insertNotification } from '@/lib/notifications'
import { formatPricePerPerson } from '@/lib/sessionDetail'
import {
    getShortSkillLabel,
    getSkillLevelFromEloRange,
} from '@/lib/skillAssessment'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'
import { useAppTheme } from '@/lib/theme-context'
import { router, useLocalSearchParams } from 'expo-router'
import {
    AlertTriangle,
    XCircle,
    Loader,
    PencilLine,
    ShieldCheck,
    UserCheck,
    UserX,
} from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { SPACING, BORDER } from '@/constants/screenLayout'

const ICON_STROKE = 2.5

type SessionOverview = {
  id: string
  host: {
    id: string
    name: string
  }
  max_players: number
  elo_min: number
  elo_max: number
  require_approval: boolean
  status: string
  is_ranked?: boolean | null
  court_booking_status?: 'confirmed' | 'unconfirmed' | null
  booking_notes?: string | null
  session_players: { player_id: string }[]
  slot: {
    start_time: string
    end_time: string
    price: number
    court: {
      name: string
      address: string
      city: string
    }
  }
}

type ApplicantRecord = {
  id: string
  player_id: string
  status: 'pending' | 'accepted' | 'rejected'
  intro_note?: string | null
  host_response_template?: string | null
  player: {
    name: string
    elo?: number | null
    current_elo?: number | null
    self_assessed_level?: string | null
    skill_label?: string | null
    sessions_joined?: number | null
    no_show_count?: number | null
    reliability_score?: number | null
  }
}

type ApplicantRow = {
  id: string
  player_id: string
  status: 'pending' | 'accepted' | 'rejected'
  intro_note?: string | null
  host_response_template?: string | null
  player:
    | {
        name?: string | null
        elo?: number | null
        current_elo?: number | null
        self_assessed_level?: string | null
        skill_label?: string | null
        sessions_joined?: number | null
        no_show_count?: number | null
        reliability_score?: number | null
      }
    | {
        name?: string | null
        elo?: number | null
        current_elo?: number | null
        self_assessed_level?: string | null
        skill_label?: string | null
        sessions_joined?: number | null
        no_show_count?: number | null
        reliability_score?: number | null
      }[]
    | null
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function getReliabilityScore(player: ApplicantRecord['player']) {
  if (player.reliability_score != null) return Math.round(player.reliability_score)
  const joined = player.sessions_joined ?? 0
  if (!joined) return null
  const noShow = player.no_show_count ?? 0
  return Math.max(0, Math.min(100, Math.round(((joined - noShow) / joined) * 100)))
}

function getReliabilityTone(theme: any, score: number | null) {
  if (score == null) {
    return {
      badgeBg: theme.surfaceContainer,
      badgeIcon: theme.outline,
      badgeText: theme.onSurfaceVariant,
    }
  }

  if (score >= 90) {
    return {
      badgeBg: theme.primaryContainer,
      badgeIcon: theme.primary,
      badgeText: theme.onPrimaryContainer,
    }
  }

    if (score >= 70) {
    return {
      badgeBg: theme.warningContainer,
      badgeIcon: theme.warningStrong,
      badgeText: theme.onWarningContainer,
    }
  }

  return {
    badgeBg: theme.errorContainer,
    badgeIcon: theme.error,
    badgeText: theme.onErrorContainer,
  }
}

function getMatchScore(playerElo: number, eloMin: number, eloMax: number) {
  if (playerElo >= eloMin && playerElo <= eloMax) {
    const target = (eloMin + eloMax) / 2
    const diff = Math.abs(playerElo - target)
    return Math.max(86, Math.min(99, Math.round(99 - diff / 12)))
  }

  const nearestEdge = playerElo < eloMin ? eloMin : eloMax
  const diff = Math.abs(playerElo - nearestEdge)
  return Math.max(12, Math.min(84, Math.round(84 - diff / 8)))
}

function formatTimeLabel(start: string, end: string) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const weekdayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  const day = `${startDate.getDate().toString().padStart(2, '0')}/${(startDate.getMonth() + 1).toString().padStart(2, '0')}`
  const startClock = `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`
  const endClock = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`
  return `${weekdayLabels[startDate.getDay()]}, ${day} • ${startClock} - ${endClock}`
}

type RequestCardProps = {
  applicant: ApplicantRecord
  eloMin: number
  eloMax: number
  onOpenPlayer: (playerId: string) => void
  onAccept: (requestId: string, playerId: string, message: string) => void
  onReject: (requestId: string, playerId: string, message: string) => void
  busy?: boolean
}

function RequestCard({
  applicant,
  eloMin,
  eloMax,
  onOpenPlayer,
  onAccept,
  onReject,
  busy = false,
}: RequestCardProps) {
  const theme = useAppTheme()
  const [message, setMessage] = useState('')
  const playerElo = applicant.player.current_elo ?? applicant.player.elo ?? 0
  const reliability = getReliabilityScore(applicant.player)
  const reliabilityTone = getReliabilityTone(theme, reliability)
  const matchScore = getMatchScore(playerElo, eloMin, eloMax)
  const lowMatch = matchScore < 50
  const diffFromTarget = playerElo - Math.round((eloMin + eloMax) / 2)

  return (
    <View
      className="mb-4 overflow-hidden rounded-[14px]"
      style={{
        borderWidth: 1,
        borderColor: theme.outlineVariant,
        backgroundColor: theme.surfaceContainerLowest,
      }}
    >
      <Pressable onPress={() => onOpenPlayer(applicant.player_id)} className="p-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1">
            <View
              className="h-12 w-12 items-center justify-center rounded-full"
              style={{ backgroundColor: theme.primaryContainer }}
            >
              <Text style={{ fontSize: 16, fontFamily: SCREEN_FONTS.headline, color: theme.onPrimaryContainer }}>
                {getInitials(applicant.player.name)}
              </Text>
            </View>
            <View className="ml-3 flex-1">
              <Text numberOfLines={1} style={{ fontSize: 16, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface }}>
                {applicant.player.name}
              </Text>
              <View className="flex-row items-center mt-0.5">
                <Text style={{ fontSize: 12, fontFamily: SCREEN_FONTS.label, color: theme.onSurfaceVariant }}>
                  {`Elo ${playerElo} • ${applicant.player.sessions_joined ?? 0} kèo`}
                </Text>
                <View className="mx-2 h-1 w-1 rounded-full bg-neutral-300" />
                <Text style={{ fontSize: 12, fontFamily: SCREEN_FONTS.cta, color: reliabilityTone.badgeText }}>
                  {reliability != null ? `${reliability}% uy tín` : 'Mới chơi'}
                </Text>
              </View>
            </View>
          </View>

          <View
            className="rounded-lg px-2 py-1"
            style={{ 
              backgroundColor: lowMatch ? theme.errorContainer : theme.secondaryContainer,
              borderWidth: 1,
              borderColor: lowMatch ? theme.error : theme.outlineVariant,
            }}
          >
            <Text style={{ fontSize: 13, fontFamily: SCREEN_FONTS.headline, color: lowMatch ? theme.error : theme.primary }}>
              {`${matchScore}%`}
            </Text>
          </View>
        </View>

        {lowMatch && (
          <View
            className="mt-3 flex-row items-center rounded-lg px-3 py-2"
            style={{ backgroundColor: theme.errorContainer }}
          >
            <AlertTriangle size={14} color={theme.error} />
            <Text className="ml-2 flex-1" style={{ fontSize: 12, fontFamily: SCREEN_FONTS.medium, color: theme.error }}>
              Lệch {diffFromTarget >= 0 ? '+' : ''}{diffFromTarget} Elo. Cân nhắc kỹ!
            </Text>
          </View>
        )}

        <View className="mt-4">
          <Text style={{ fontSize: 10, fontFamily: SCREEN_FONTS.headline, color: theme.outline, textTransform: 'uppercase', letterSpacing: 1 }}>
            LỜI NHẮN
          </Text>
          <Text className="mt-1 text-[14px] leading-5" style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body }}>
            {applicant.intro_note?.trim() ? applicant.intro_note : 'Người chơi này không để lại lời nhắn.'}
          </Text>
        </View>
      </Pressable>

      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: theme.surfaceContainerLow,
          borderTopWidth: 1,
          borderColor: theme.outlineVariant,
        }}
      >
        <View className="mt-1">
          <Text style={{ fontSize: 10, fontFamily: SCREEN_FONTS.headline, color: theme.outline, textTransform: 'uppercase', letterSpacing: 1 }}>
            PHẢN HỒI CỦA BẠN
          </Text>
          <View 
            className="mt-2 rounded-[10px] border px-3 py-2"
            style={{ borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLowest }}
          >
            <TextInput
              placeholder="Nhập lời nhắn cho người chơi (không bắt buộc)..."
              placeholderTextColor={theme.outline}
              value={message}
              onChangeText={setMessage}
              multiline
              style={{
                fontFamily: SCREEN_FONTS.body,
                fontSize: 16,
                color: theme.onSurface,
                minHeight: 60,
                textAlignVertical: 'top',
              }}
            />
          </View>
        </View>

        <View className="mt-4 flex-row gap-3">
          <Pressable
            onPress={() => onReject(applicant.id, applicant.player_id, message)}
            disabled={busy}
            className="active:opacity-70 h-12 flex-1 flex-row items-center justify-center rounded-[10px]"
            style={{ backgroundColor: theme.surfaceContainerLowest, borderWidth: 1, borderColor: theme.outlineVariant }}
          >
            <UserX size={16} color={theme.onSurfaceVariant} strokeWidth={2.3} />
            <Text className="ml-2" style={{ fontSize: 13, fontFamily: SCREEN_FONTS.headline, color: theme.onSurfaceVariant }}>TỪ CHỐI</Text>
          </Pressable>

          <Pressable
            onPress={() => onAccept(applicant.id, applicant.player_id, message)}
            disabled={busy}
            className="active:opacity-90 h-12 flex-[1.5] flex-row items-center justify-center rounded-[10px]"
            style={{ backgroundColor: theme.primary }}
          >
            <UserCheck size={16} color={theme.onPrimary} strokeWidth={2.3} />
            <Text className="ml-2" style={{ fontSize: 13, fontFamily: SCREEN_FONTS.headline, color: theme.onPrimary }}>CHẤP NHẬN</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

export default function HostReviewCenterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { userId } = useAuth()
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const [session, setSession] = useState<SessionOverview | null>(null)
  const [applicants, setApplicants] = useState<ApplicantRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)

  const premiumShadow = (elevation = 5) => ({
    shadowColor: theme.onBackground,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation,
  })

  const fetchData = useCallback(async () => {
    if (!id) return

    setLoading(true)

    const [{ data: overview, error: sessionError }, { data: requestRows, error: requestError }] = await Promise.all([
      supabase.rpc('get_session_detail_overview', { p_session_id: id }),
      supabase
        .from('join_requests')
        .select(`
          id, player_id, status, intro_note, host_response_template,
          player:player_id (
            name, elo, current_elo, self_assessed_level, skill_label, sessions_joined, no_show_count, reliability_score
          )
        `)
        .eq('match_id', id)
        .eq('status', 'pending'),
    ])

    if (sessionError) {
      setLoading(false)
      setDialogConfig({
        title: 'Lỗi',
        message: sessionError.message,
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    if (requestError) {
      setLoading(false)
      setDialogConfig({
        title: 'Lỗi',
        message: requestError.message,
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    const nextSession = (overview?.session ?? null) as SessionOverview | null
    const nextApplicants: ApplicantRecord[] = ((requestRows as ApplicantRow[] | null) ?? []).map((item) => {
      const player = Array.isArray(item.player) ? item.player[0] : item.player

      return {
        id: item.id,
        player_id: item.player_id,
        status: item.status,
        intro_note: item.intro_note ?? null,
        host_response_template: item.host_response_template ?? null,
        player: {
          name: player?.name ?? 'Người chơi',
          elo: player?.elo ?? null,
          current_elo: player?.current_elo ?? null,
          self_assessed_level: player?.self_assessed_level ?? null,
          skill_label: player?.skill_label ?? null,
          sessions_joined: player?.sessions_joined ?? null,
          no_show_count: player?.no_show_count ?? null,
          reliability_score: player?.reliability_score ?? null,
        },
      }
    })

    setSession(nextSession)
    setApplicants(nextApplicants)
    setLoading(false)
  }, [id])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  async function approveRequest(requestId: string, playerId: string, message: string) {
    if (!session) return

    setSubmittingId(requestId)

    // Save host response if provided
    if (message.trim()) {
      await supabase
        .from('join_requests')
        .update({ host_response_template: message.trim() })
        .eq('id', requestId)
    }

    const { error } = await supabase.rpc('approve_join_request', { p_request_id: requestId })

    if (error) {
      setSubmittingId(null)
      setDialogConfig({
        title: 'Lỗi',
        message: error.message,
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    setApplicants((prev) => prev.filter((item) => item.id !== requestId))
    setSession((prev) =>
      prev
        ? {
            ...prev,
            session_players: [...prev.session_players, { player_id: playerId }],
          }
        : prev
    )

    const slotTime = new Date(session.slot.start_time).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    })

    await insertNotification(
      playerId,
      'Được duyệt!',
      message.trim() || `Bạn đã được chấp nhận vào kèo lúc ${slotTime}.`,
      'join_approved',
      `/session/${session.id}`,
    )

    setSubmittingId(null)
    router.replace({ pathname: '/session/[id]' as any, params: { id: session.id } })
  }

  async function rejectRequest(requestId: string, playerId: string, message: string) {
    if (!session) return

    setSubmittingId(requestId)
    const { error } = await supabase
      .from('join_requests')
      .update({ 
        status: 'rejected',
        host_response_template: message.trim() || null 
      })
      .eq('id', requestId)

    if (error) {
      setSubmittingId(null)
      setDialogConfig({
        title: 'Lỗi',
        message: error.message,
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    setApplicants((prev) => prev.filter((item) => item.id !== requestId))

    await insertNotification(
      playerId,
      'Chưa phù hợp',
      message.trim() || 'Host đã từ chối yêu cầu tham gia của bạn.',
      'join_rejected',
      `/session/${session.id}`,
    )

    setSubmittingId(null)
    router.replace({ pathname: '/session/[id]' as any, params: { id: session.id } })
  }


  function cancelSession() {
    if (!session) return

    const isFull = session.session_players.length >= session.max_players
    const playerIdsToNotify = session.session_players
      .filter((player) => player.player_id !== session.host.id)
      .map((player) => player.player_id)
    const slotTime = new Date(session.slot.start_time).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    })

    setDialogConfig({
      title: isFull ? 'Kèo đã đủ người' : 'Hủy kèo?',
      message: isFull
        ? 'Kèo đã đủ người chơi, việc hủy kèo sẽ ảnh hưởng đến tỷ lệ uy tín của bạn. Bạn có chắc không?'
        : 'Kèo sẽ bị hủy và toàn bộ người chơi sẽ được thông báo. Không thể hoàn tác.',
      actions: [
        { label: 'Không', tone: 'secondary' },
        {
          label: 'Hủy kèo',
          tone: 'danger',
          onPress: async () => {
            setCancelling(true)
            const { error } = await supabase.rpc('cancel_host_session', { p_session_id: session.id })

            if (error) {
              setCancelling(false)
              setDialogConfig({
                title: 'Lỗi',
                message: error.message,
                actions: [{ label: 'Đã hiểu' }],
              })
              return
            }

            await Promise.all(
              playerIdsToNotify.map((playerId) =>
                insertNotification(
                  playerId,
                  'Host đã hủy kèo',
                  `Kèo lúc ${slotTime} đã bị host hủy.`,
                  'session_cancelled',
                  `/session/${session.id}`,
                )
              )
            )

            setCancelling(false)
            setDialogConfig({
              title: 'Đã hủy kèo',
              message: 'Kèo của bạn đã được hủy.',
              actions: [{ label: 'OK', onPress: () => router.replace('/player-hub/my-sessions' as any) }],
            })
          },
        },
      ]
    })
  }

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center" style={{ backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </SafeAreaView>
    )
  }

  if (!session) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-6" style={{ backgroundColor: theme.background }}>
        <Text style={{ textAlign: 'center', fontSize: 15, fontFamily: SCREEN_FONTS.label, color: theme.outline }}>Không tìm thấy dữ liệu review cho kèo này.</Text>
      </SafeAreaView>
    )
  }

  if (!userId || userId !== session.host.id) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-6" style={{ backgroundColor: theme.background }}>
        <XCircle size={48} color={theme.error} strokeWidth={1.5} />
        <Text className="mt-4 text-center" style={{ fontSize: 18, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface }}>Bạn không có quyền truy cập</Text>
        <Text className="mt-2 text-center text-[14px] leading-6" style={{ color: theme.onSurfaceVariant }}>
          Chỉ host của kèo mới có thể xem và xử lý trung tâm duyệt yêu cầu này.
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-6 active:scale-95 rounded-2xl px-5 py-3.5"
          style={{ backgroundColor: theme.primary }}
        >
          <Text style={{ fontSize: 14, fontFamily: SCREEN_FONTS.headline, color: theme.onPrimary }}>Quay lại</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  const sessionSkill = getSkillLevelFromEloRange(session.elo_min, session.elo_max)

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <View className="flex-1">
        <SecondaryNavbar 
          title="REVIEW TRẬN ĐẤU"
          onBackPress={() => router.back()} 
        />
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: SPACING.xl,
            paddingTop: 12,
            paddingBottom: 140 + insets.bottom,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View className="mt-5">
            <SessionMetaCard
              skillLevelId={sessionSkill.id}
              sessionSkillLabel={getShortSkillLabel(sessionSkill)}
              courtBookingStatus={session.court_booking_status ?? 'unconfirmed'}
              courtName={session.slot.court.name}
              courtAddress={session.slot.court.address}
              courtCity={session.slot.court.city}
              timeLabel={formatTimeLabel(session.slot.start_time, session.slot.end_time)}
              priceLabel={formatPricePerPerson(session.slot.price, session.max_players)}
              isRanked={session.is_ranked ?? true}
              hostNote={session.booking_notes}
              sessionStatus={session.status}
              maxPlayers={session.max_players}
            />
          </View>

          <View className="mt-6">
            {applicants.length > 0 ? (
              applicants.map((applicant) => (
                <RequestCard
                  key={applicant.id}
                  applicant={applicant}
                  eloMin={session.elo_min}
                  eloMax={session.elo_max}
                  onOpenPlayer={(playerId) => router.push({ pathname: '/player/[id]' as any, params: { id: playerId } })}
                  onAccept={approveRequest}
                  onReject={rejectRequest}
                  busy={submittingId === applicant.id}
                />
              ))
            ) : (
              <View
                className="items-center rounded-[24px] border px-6 py-12"
                style={{
                  borderColor: theme.outlineVariant,
                  backgroundColor: theme.surfaceContainerLowest,
                  ...premiumShadow(4),
                }}
              >
                <View className="h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: theme.primaryContainer }}>
                  <ShieldCheck size={24} color={theme.primary} strokeWidth={ICON_STROKE} />
                </View>
                <Text className="mt-4 text-center" style={{ fontSize: 22, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface }}>Không còn yêu cầu chờ duyệt</Text>
                <Text
                  className="mt-2 text-center"
                  style={{ fontSize: 14, lineHeight: 24, fontFamily: SCREEN_FONTS.body, color: theme.onSurfaceVariant }}
                >
                  Review center đang trống. Khi có người muốn tham gia, hồ sơ của họ sẽ xuất hiện tại đây.
                </Text>
              </View>
            )}
          </View>
        </ScrollView>

        <View
          className="absolute bottom-0 left-0 right-0 border-t px-5 pt-4"
          style={{
            borderColor: theme.outlineVariant,
            backgroundColor: theme.surfaceContainerLowest,
            paddingBottom: Math.max(insets.bottom, 16),
          }}
        >
          <View className="flex-row gap-3">
            <Pressable
              onPress={cancelSession}
              disabled={cancelling}
              className="active:scale-95 h-14 flex-1 flex-row items-center justify-center rounded-[20px]"
              style={{
                borderWidth: BORDER.base,
                borderColor: theme.outlineVariant,
                backgroundColor: theme.errorContainer,
              }}
            >
              {cancelling ? (
                <Loader size={18} color={theme.onErrorContainer} />
              ) : (
                <XCircle size={18} color={theme.onErrorContainer} strokeWidth={ICON_STROKE} />
              )}
              <Text className="ml-2 text-[14px]" style={{ fontFamily: SCREEN_FONTS.headline, color: theme.onErrorContainer }}>
                {cancelling ? 'ĐANG HỦY...' : 'HỦY KÈO'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() =>
                router.replace({
                  pathname: '/session/[id]' as any,
                  params: { id: session.id, edit: '1' },
                })
              }
              className="active:scale-95 h-14 flex-[1.2] flex-row items-center justify-center rounded-[20px]" style={{ backgroundColor: theme.primary }}
            >
              <PencilLine size={18} color={theme.onPrimary} strokeWidth={ICON_STROKE} />
              <Text className="ml-2 text-[14px]" style={{ fontFamily: SCREEN_FONTS.headline, color: theme.onPrimary }}>CHỈNH SỬA KÈO</Text>
            </Pressable>
          </View>
        </View>
        <AppDialog
          visible={Boolean(dialogConfig)}
          config={dialogConfig}
          onClose={() => setDialogConfig(null)}
        />
      </View>
    </View>
  )
}
