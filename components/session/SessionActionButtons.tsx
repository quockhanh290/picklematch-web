import React from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import { LogOut, PencilLine, Repeat2, Save, Star, Trophy, ShieldAlert, Hourglass, LayoutDashboard } from 'lucide-react-native'
import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { router } from 'expo-router'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'

interface SessionActionButtonsProps {
  id: string
  session: any
  isHost: boolean
  hasJoined: boolean
  isAfterEnd: boolean
  isDuringMatch: boolean
  isCancelled: boolean
  viewerSessionPlayer: any
  hostPrimaryMode: 'edit' | 'arranging' | 'save'
  hostPrimaryDisabled: boolean
  hostActionBusy: boolean
  savingArrangement: boolean
  leaving: boolean
  onSaveArrangement: () => void
  leaveSession: () => void
  onArrangementPress?: () => void
  checkInCompleted?: boolean
  hideArrangementCta?: boolean
  hideInputResult?: boolean
  matchesCount?: number
}

const PartialPlayerWarning = ({ count, max, theme }: { count: number; max: number; theme: any }) => (
  <View 
    style={{ 
      marginBottom: SPACING.md, 
      padding: SPACING.md, 
      borderRadius: RADIUS.md, 
      backgroundColor: theme.warningBg, 
      borderWidth: 1, 
      borderColor: theme.warningStrong,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm
    }}
  >
    <ShieldAlert size={20} color={theme.warningStrong} />
    <Text style={{ flex: 1, fontSize: 13, fontFamily: SCREEN_FONTS.body, color: theme.warningText }}>
      {STRINGS.session.labels.partial_player_warning
        .replace('{count}', count.toString())
        .replace('{max}', max.toString())
        .replace('{person}', STRINGS.common.person)}
    </Text>
  </View>
)

const SessionStatusBanner = ({ 
  isCancelled, 
  isInvalidPlayerCount, 
  hasJoined, 
  isFinalized, 
  isAfterEnd,
  checkInCompleted,
  matchesCount,
  theme 
}: { 
  isCancelled: boolean; 
  isInvalidPlayerCount: boolean; 
  hasJoined: boolean; 
  isFinalized: boolean; 
  isAfterEnd?: boolean;
  checkInCompleted?: boolean;
  matchesCount?: number;
  theme: any 
}) => {
  const isCancelledNoCheckin = isAfterEnd && !checkInCompleted && !isCancelled
  const isNoData = isAfterEnd && checkInCompleted && matchesCount === 0

  const bgColor = (isCancelled || isCancelledNoCheckin) ? theme.dangerBg : isNoData ? theme.surfaceVariant : theme.dangerBg
  const borderColor = (isCancelled || isCancelledNoCheckin) ? theme.dangerBorderSoft : isNoData ? theme.outlineVariant : theme.dangerBorderSoft
  const textColor = (isCancelled || isCancelledNoCheckin) ? theme.dangerText : isNoData ? theme.onSurfaceVariant : theme.dangerText

  let label = isInvalidPlayerCount ? STRINGS.session.labels.cancelled_no_players : STRINGS.session.labels.cancelled_generic
  if (isCancelledNoCheckin) label = 'KÈO KHÔNG DIỄN RA (CHƯA CHECK-IN)'
  if (isNoData) label = 'KÈO ĐÃ KẾT THÚC (THIẾU DỮ LIỆU)'

  return (
    <View
      style={{
        width: '100%',
        minHeight: 52,
        paddingVertical: 11,
        paddingHorizontal: 16,
        borderRadius: RADIUS.md,
        backgroundColor: bgColor,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: BORDER.base,
        borderColor: borderColor,
        marginBottom: hasJoined && !isFinalized ? SPACING.md : 0,
      }}
    >
      <Text
        style={{
          fontSize: 14,
          fontFamily: SCREEN_FONTS.headline,
          color: textColor,
          textTransform: 'uppercase',
          textAlign: 'center'
        }}
      >
        {label}
      </Text>
    </View>
  )
}

const HostPastSessionView = ({ theme }: { theme: any }) => (
  <View
    style={{
      width: '100%',
      minHeight: 52,
      paddingVertical: 11,
      borderRadius: RADIUS.md,
      backgroundColor: theme.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: BORDER.base,
      borderColor: theme.outlineVariant,
    }}
  >
    <Text
      style={{
        fontSize: 15,
        fontFamily: SCREEN_FONTS.headline,
        color: theme.outline,
        textTransform: 'uppercase',
      }}
    >
      {STRINGS.session.status.past}
    </Text>
  </View>
)

const HostFinalizedSessionView = ({ id, theme }: { id: string; theme: any }) => {
  return (
    <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
      <TouchableOpacity 
        onPress={() => router.push(`/host/session/${id}/matches` as any)}
        activeOpacity={0.84}
        style={{
          flex: 1,
          minHeight: 52,
          backgroundColor: '#E1F5EE',
          borderRadius: RADIUS.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          borderWidth: 1,
          borderColor: '#0F6E5630'
        }}
      >
        <LayoutDashboard size={18} color="#0F6E56" />
        <Text style={{ fontSize: 14, fontFamily: SCREEN_FONTS.headline, color: '#0F6E56' }}>XEM KẾT QUẢ</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        onPress={() => router.push(`/host/session/${id}/recap` as any)}
        activeOpacity={0.84}
        style={{
          flex: 1,
          minHeight: 52,
          backgroundColor: '#FAECE7',
          borderRadius: RADIUS.md,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          borderWidth: 1,
          borderColor: '#D85A3030'
        }}
      >
        <Trophy size={18} color="#993C1D" />
        <Text style={{ fontSize: 14, fontFamily: SCREEN_FONTS.headline, color: '#993C1D' }}>BẢNG XẾP HẠNG</Text>
      </TouchableOpacity>
    </View>
  )
}

const HostSubmittedSessionView = ({ id, session, theme }: { id: string; session: any; theme: any }) => {
  const { onViewMatchResult } = useSessionNav()
  const resultsStatus = session?.results_status
  const isDisputed = resultsStatus === 'disputed'
  return (
    <TouchableOpacity
      onPress={() => {
        if (isDisputed) {
          onViewMatchResult(id)
        }
      }}
      activeOpacity={0.84}
      style={{
        alignSelf: 'center',
        paddingHorizontal: SPACING.xl,
        minHeight: 52,
        paddingVertical: 11,
        borderRadius: RADIUS.md,
        backgroundColor: isDisputed ? theme.primary : theme.surfaceContainerHigh,
        borderWidth: BORDER.base,
        borderColor: isDisputed ? theme.primary : theme.outlineVariant,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {isDisputed ? (
          <PencilLine size={18} strokeWidth={2.5} color={theme.onPrimary} />
        ) : (
          <ActivityIndicator size="small" color={theme.outline} />
        )}
        <Text
          style={{
            fontSize: 15,
            fontFamily: SCREEN_FONTS.headline,
            color: isDisputed ? theme.onPrimary : theme.outline,
            textTransform: 'uppercase',
          }}
        >
          {isDisputed ? STRINGS.session.labels.edit_result : STRINGS.session.labels.awaiting_confirmation}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

const HostAwaitingResultView = ({ id, isPartial, count, max, theme }: any) => {
  return (
    <View style={{ width: '100%' }}>
      {isPartial && <PartialPlayerWarning count={count} max={max} theme={theme} />}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity 
          onPress={() => router.push(`/host/session/${id}/matches` as any)}
          activeOpacity={0.84}
          style={{
            flex: 1,
            minHeight: 52,
            backgroundColor: theme.primary,
            borderRadius: RADIUS.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <LayoutDashboard size={18} color={theme.onPrimary} />
          <Text style={{ fontSize: 14, fontFamily: SCREEN_FONTS.headline, color: theme.onPrimary }}>XEM KẾT QUẢ</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={() => router.push(`/host/session/${id}/recap` as any)}
          activeOpacity={0.84}
          style={{
            flex: 1,
            minHeight: 52,
            backgroundColor: 'transparent',
            borderRadius: RADIUS.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            borderWidth: 1,
            borderColor: theme.primary + '30'
          }}
        >
          <Trophy size={18} color={theme.primary} />
          <Text style={{ fontSize: 14, fontFamily: SCREEN_FONTS.headline, color: theme.primary }}>XẾP HẠNG</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const HostActiveActionsView = ({
  session,
  hostPrimaryMode,
  hostPrimaryDisabled,
  savingArrangement,
  leaving,
  hostActionBusy,
  onSaveArrangement,
  leaveSession,
  onArrangementPress,
  checkInCompleted,
  hideArrangementCta,
  hideInputResult,
  theme
}: any) => {
  const { onEditSession } = useSessionNav()
  const confirmedCount = (session?.session_players ?? []).filter((p: any) => p.status === 'confirmed').length
  const maxPlayers = session?.max_players || 4
  const isFull = confirmedCount >= maxPlayers

  return (
    <View style={{ width: '100%' }}>
      {/* New Top CTA */}
      {checkInCompleted && !hideArrangementCta && (
        <TouchableOpacity
          onPress={onArrangementPress}
          disabled={!isFull}
        activeOpacity={0.8}
        style={{
          width: '100%',
          minHeight: 52,
          paddingVertical: 12,
          borderRadius: RADIUS.md,
          backgroundColor: isFull ? theme.primary : theme.surfaceContainerHigh,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 10,
          borderWidth: isFull ? 0 : 1,
          borderColor: isFull ? 'transparent' : theme.outlineVariant,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {isFull ? (
            <LayoutDashboard size={18} color={theme.onPrimary} />
          ) : (
            <Hourglass size={18} color={theme.outline} />
          )}
          <Text style={{ 
            fontFamily: SCREEN_FONTS.headline, 
            fontSize: 15, 
            color: isFull ? theme.onPrimary : theme.outline, 
            textTransform: 'uppercase' 
          }}>
            {isFull ? 'SẮP XẾP ĐỘI' : `CẦN THÊM ${maxPlayers - confirmedCount} NGƯỜI`}
          </Text>
        </View>
        </TouchableOpacity>
      )}

      <View style={{ width: '100%', flexDirection: 'row', alignSelf: 'center' }}>
      <TouchableOpacity
        onPress={() => {
          if (hostPrimaryMode === 'edit') {
            onEditSession(session.id)
            return
          }
          if (hostPrimaryMode === 'save') {
            onSaveArrangement()
          }
        }}
      disabled={hostPrimaryDisabled}
      activeOpacity={0.84}
      style={{
        flex: 1,
        paddingHorizontal: SPACING.md,
        minHeight: 52,
        paddingVertical: 11,
        borderRadius: RADIUS.md,
        backgroundColor: theme.primary,
        opacity: hostPrimaryDisabled && !savingArrangement ? 0.55 : 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {savingArrangement ? (
          <ActivityIndicator size="small" color={theme.onPrimary} />
        ) : hostPrimaryMode === 'edit' ? (
          <PencilLine size={16} strokeWidth={2.5} color={theme.onPrimary} />
        ) : hostPrimaryMode === 'save' ? (
          <Save size={16} strokeWidth={2.5} color={theme.onPrimary} />
        ) : (
          <Repeat2 size={16} strokeWidth={2.5} color={theme.onPrimary} />
        )}
        <Text
          style={{
            fontSize: 15,
            fontFamily: SCREEN_FONTS.headline,
            color: theme.onPrimary,
            textTransform: 'uppercase',
          }}
        >
          {savingArrangement
            ? STRINGS.session.buttons.saving
            : hostPrimaryMode === 'edit'
              ? STRINGS.session.buttons.edit_session
              : hostPrimaryMode === 'save'
                ? STRINGS.session.buttons.save_changes
                : STRINGS.session.buttons.arranging}
        </Text>
      </View>
    </TouchableOpacity>

    <TouchableOpacity
      onPress={leaveSession}
      disabled={hostActionBusy}
      activeOpacity={0.84}
      style={{
        flex: 1,
        marginLeft: 10,
        paddingHorizontal: SPACING.md,
        minHeight: 52,
        paddingVertical: 11,
        borderRadius: RADIUS.md,
        backgroundColor: theme.dangerStrong,
        opacity: hostActionBusy ? 0.55 : 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {leaving ? (
          <ActivityIndicator size="small" color={theme.onPrimary} />
        ) : (
          <LogOut size={16} strokeWidth={2.5} color={theme.onPrimary} />
        )}
        <Text
          style={{
            fontSize: 15,
            fontFamily: SCREEN_FONTS.headline,
            color: theme.onPrimary,
            textTransform: 'uppercase',
          }}
        >
          {leaving ? STRINGS.session.buttons.cancelling : STRINGS.session.buttons.cancel_session}
        </Text>
      </View>
    </TouchableOpacity>
  </View>
</View>
  )
}

const HostActions = ({
  id,
  session,
  isAfterEnd,
  isDuringMatch,
  isFinalized,
  isResultSubmitted,
  isAwaitingResult,
  isPartialPlayerCount,
  isInvalidPlayerCount,
  confirmedPlayerCount,
  maxPlayers,
  hasRated,
  hostPrimaryMode,
  hostPrimaryDisabled,
  savingArrangement,
  leaving,
  hostActionBusy,
  onSaveArrangement,
  leaveSession,
  onArrangementPress,
  editPathname,
  checkInCompleted,
  hideArrangementCta,
  hideInputResult,
  isCancelled,
  matchesCount,
  theme
}: any) => {
  const parseRobustDate = (d: any) => {
    let str = String(d).trim()
    str = str.replace(/^[^\d]+/, '')
    let t = new Date(str).getTime()
    if (!isNaN(t)) return t
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
  
  const now = Date.now()
  const startTime = parseRobustDate(session.slot?.start_time)
  const endTime = parseRobustDate(session.slot?.end_time)
  
  const isWayPastStart = startTime > 0 && (now - startTime) > (12 * 3600000)
  
  // Re-calculate everything internally to be 100% sure
  const internalIsPastEnd = (endTime > 0 && endTime <= now) || 
                            ['completed', 'finished', 'archived', 'done', 'pending_results', 'pending_completion', 'cancelled_no_players', 'failed_to_fill'].includes(session.status) ||
                            isWayPastStart
  const internalIsDuringMatch = startTime > 0 && startTime <= now && !internalIsPastEnd
  
  const actualIsPastEnd = internalIsPastEnd || isAfterEnd || isFinalized
  const effectiveIsDuringMatch = internalIsDuringMatch || (isDuringMatch && !actualIsPastEnd)

  if (isCancelled || session.status === 'cancelled' || isInvalidPlayerCount) {
    return <SessionStatusBanner isCancelled={isCancelled || session.status === 'cancelled'} isInvalidPlayerCount={isInvalidPlayerCount} hasJoined={true} isFinalized={false} theme={theme} />
  }

  // Case 1: Session ended without check-in -> Cancelled
  if (actualIsPastEnd && !checkInCompleted) {
    return <SessionStatusBanner isCancelled={true} isInvalidPlayerCount={false} hasJoined={true} isFinalized={false} isAfterEnd={true} checkInCompleted={false} theme={theme} />
  }

  // Case 2: Session ended with check-in but no matches -> Finished with warning
  if (actualIsPastEnd && checkInCompleted && matchesCount === 0) {
    return <SessionStatusBanner isCancelled={false} isInvalidPlayerCount={false} hasJoined={true} isFinalized={false} isAfterEnd={true} checkInCompleted={true} matchesCount={0} theme={theme} />
  }

  // Case 3: Session ended with data -> Finalized or Awaiting Results
  if (actualIsPastEnd && checkInCompleted && matchesCount > 0) {
    if (isFinalized) return <HostFinalizedSessionView id={id} theme={theme} />
    if (isAwaitingResult) return <HostAwaitingResultView id={id} theme={theme} />
    return <HostPastSessionView theme={theme} />
  }

  if (isFinalized) {
    return <HostFinalizedSessionView id={id} theme={theme} />
  }

  if (isResultSubmitted) {
    return <HostSubmittedSessionView id={id} session={session} theme={theme} />
  }

  if (isAwaitingResult) {
    return <HostAwaitingResultView id={id} isPartial={isPartialPlayerCount} count={confirmedPlayerCount} max={maxPlayers} theme={theme} />
  }

  if (effectiveIsDuringMatch) {
    return (
      <View
        style={{
          width: '100%',
          paddingHorizontal: SPACING.md,
          minHeight: 52,
          paddingVertical: 11,
          borderRadius: RADIUS.md,
          backgroundColor: theme.surfaceContainerHigh,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          borderWidth: BORDER.base,
          borderColor: theme.outlineVariant,
          opacity: 0.8
        }}
      >
        <ActivityIndicator size="small" color={theme.outline} />
        <Text
          style={{
            fontSize: 15,
            fontFamily: SCREEN_FONTS.headline,
            color: theme.outline,
            textTransform: 'uppercase',
          }}
        >
          {'Kèo đang diễn ra'}
        </Text>
      </View>
    )
  }

  return (
    <HostActiveActionsView
      session={session}
      hostPrimaryMode={hostPrimaryMode}
      hostPrimaryDisabled={hostPrimaryDisabled}
      savingArrangement={savingArrangement}
      leaving={leaving}
      hostActionBusy={hostActionBusy}
      onSaveArrangement={onSaveArrangement}
      leaveSession={leaveSession}
      onArrangementPress={onArrangementPress}
      checkInCompleted={checkInCompleted}
      hideArrangementCta={hideArrangementCta}
      hideInputResult={hideInputResult}
      theme={theme}
    />
  )
}

const PlayerPastSessionView = ({ theme }: { theme: any }) => (
  <View
    style={{
      alignSelf: 'center',
      paddingHorizontal: SPACING.xl,
      minHeight: 52,
      paddingVertical: 11,
      borderRadius: RADIUS.md,
      backgroundColor: theme.surfaceContainerHigh,
      borderWidth: BORDER.base,
      borderColor: theme.outlineVariant,
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <Text style={{ fontSize: 15, fontFamily: SCREEN_FONTS.headline, color: theme.outline, textTransform: 'uppercase' }}>
      {STRINGS.session.status.past}
    </Text>
  </View>
)

const PlayerFinalizedSessionView = ({ id, hasRated, theme }: { id: string; hasRated: boolean; theme: any }) => {
  const { onRateSession, onConfirmResult } = useSessionNav()
  const label = hasRated ? STRINGS.session.buttons.view_result : STRINGS.session.buttons.rate_match
  const action = !hasRated 
    ? () => onRateSession(id)
    : () => onConfirmResult(id)
  const Icon = hasRated ? Trophy : Star

  return (
    <TouchableOpacity
      onPress={action}
      activeOpacity={0.84}
      style={{
        alignSelf: 'center',
        paddingHorizontal: SPACING.xl,
        minHeight: 52,
        paddingVertical: 11,
        borderRadius: RADIUS.md,
        backgroundColor: theme.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon size={18} strokeWidth={2.5} color={theme.onPrimary} />
        <Text style={{ fontSize: 15, fontFamily: SCREEN_FONTS.headline, color: theme.onPrimary, textTransform: 'uppercase' }}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

const PlayerPendingConfirmView = ({ id, hasConfirmed, theme }: { id: string; hasConfirmed: boolean; theme: any }) => {
  const { onConfirmResult } = useSessionNav()
  const label = hasConfirmed ? STRINGS.session.buttons.view_result : STRINGS.session.buttons.confirm_result
  const action = () => onConfirmResult(id)
  const Icon = hasConfirmed ? Trophy : PencilLine

  return (
    <TouchableOpacity
      onPress={action}
      activeOpacity={0.84}
      style={{
        alignSelf: 'center',
        paddingHorizontal: SPACING.xl,
        minHeight: 52,
        paddingVertical: 11,
        borderRadius: RADIUS.md,
        backgroundColor: hasConfirmed ? theme.surfaceContainerHigh : theme.primary,
        borderWidth: hasConfirmed ? BORDER.base : 0,
        borderColor: hasConfirmed ? theme.outlineVariant : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon size={18} strokeWidth={2.5} color={hasConfirmed ? theme.outline : theme.onPrimary} />
        <Text style={{ 
          fontSize: 15, 
          fontFamily: SCREEN_FONTS.headline, 
          color: hasConfirmed ? theme.outline : theme.onPrimary, 
          textTransform: 'uppercase' 
        }}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

const PlayerAwaitingConfirmationView = ({ isInvalidPlayerCount, theme }: { isInvalidPlayerCount: boolean; theme: any }) => (
  <View
    style={{
      alignSelf: 'center',
      paddingHorizontal: SPACING.xl,
      minHeight: 52,
      paddingVertical: 11,
      borderRadius: RADIUS.md,
      backgroundColor: theme.surfaceContainerHigh,
      borderWidth: BORDER.base,
      borderColor: theme.outlineVariant,
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <ActivityIndicator size="small" color={theme.outline} />
      <Text style={{ fontSize: 15, fontFamily: SCREEN_FONTS.headline, color: theme.outline, textTransform: 'uppercase' }}>
        {isInvalidPlayerCount ? STRINGS.session.labels.cancelled_no_players : STRINGS.session.labels.awaiting_confirmation}
      </Text>
    </View>
  </View>
)

const PlayerDuringMatchView = ({ leaving, leaveSession, theme }: any) => (
  <View style={{ width: '100%' }}>
    <View
      style={{
        alignSelf: 'center',
        width: '100%',
        minHeight: 52,
        paddingVertical: 11,
        borderRadius: RADIUS.md,
        backgroundColor: theme.surfaceContainerHigh,
        borderWidth: BORDER.base,
        borderColor: theme.outlineVariant,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: SPACING.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <ActivityIndicator size="small" color={theme.outline} />
        <Text style={{ fontSize: 15, fontFamily: SCREEN_FONTS.headline, color: theme.outline, textTransform: 'uppercase' }}>
          {STRINGS.session.labels.in_progress_match}
        </Text>
      </View>
    </View>
    
    <TouchableOpacity
      onPress={leaveSession}
      disabled={leaving}
      activeOpacity={0.84}
      style={{
        alignSelf: 'center',
        paddingHorizontal: SPACING.xl,
        minHeight: 44,
        paddingVertical: 8,
        borderRadius: RADIUS.md,
        backgroundColor: theme.surfaceContainerLow,
        borderWidth: BORDER.base,
        borderColor: theme.outlineVariant,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: leaving ? 0.6 : 1,
      }}
    >
      <Text style={{ fontSize: 13, fontFamily: SCREEN_FONTS.headline, color: theme.outline, textTransform: 'uppercase' }}>
        {leaving ? STRINGS.session.buttons.leaving : STRINGS.session.buttons.leave_session}
      </Text>
    </TouchableOpacity>
  </View>
)

const PlayerActiveActionsView = ({ leaving, leaveSession, theme }: any) => (
  <TouchableOpacity
    onPress={leaveSession}
    disabled={leaving}
    activeOpacity={0.84}
    style={{
      alignSelf: 'center',
      paddingHorizontal: SPACING.xl,
      minHeight: 52,
      paddingVertical: 11,
      borderRadius: RADIUS.md,
      backgroundColor: theme.dangerStrong,
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {leaving ? (
        <ActivityIndicator size="small" color={theme.onPrimary} />
      ) : (
        <LogOut size={16} strokeWidth={2.5} color={theme.onPrimary} />
      )}
      <Text style={{ fontSize: 15, fontFamily: SCREEN_FONTS.headline, color: theme.onPrimary, textTransform: 'uppercase' }}>
        {leaving ? STRINGS.session.buttons.leaving : STRINGS.session.buttons.leave_session}
      </Text>
    </View>
  </TouchableOpacity>
)

const PlayerActions = ({
  id,
  session,
  isAfterEnd,
  isDuringMatch,
  isFinalized,
  isPendingConfirm,
  isInvalidPlayerCount,
  hasRated,
  viewerSessionPlayer,
  leaving,
  leaveSession,
  theme
}: any) => {
  if (isAfterEnd && !session?.is_ranked) {
    return <PlayerPastSessionView theme={theme} />
  }

  if (isFinalized) {
    return <PlayerFinalizedSessionView id={id} hasRated={hasRated} theme={theme} />
  }

  const hasConfirmed = viewerSessionPlayer?.result_confirmation_status === 'confirmed' || viewerSessionPlayer?.result_confirmation_status === 'disputed'

  if (isPendingConfirm || (hasConfirmed && !isFinalized)) {
    return <PlayerPendingConfirmView id={id} hasConfirmed={hasConfirmed} theme={theme} />
  }

  if (isAfterEnd) {
    return <PlayerAwaitingConfirmationView isInvalidPlayerCount={isInvalidPlayerCount} theme={theme} />
  }

  if (isDuringMatch) {
    return <PlayerDuringMatchView leaving={leaving} leaveSession={leaveSession} theme={theme} />
  }

  return <PlayerActiveActionsView leaving={leaving} leaveSession={leaveSession} theme={theme} />
}

const PublicActions = ({
  isEnded,
  isDuringMatch,
  theme
}: any) => {
  if (isEnded) {
    return (
      <View
        style={{
          width: '100%',
          minHeight: 52,
          paddingVertical: 11,
          borderRadius: RADIUS.md,
          backgroundColor: theme.surfaceContainerHigh,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: BORDER.base,
          borderColor: theme.outlineVariant,
        }}
      >
        <Text
          style={{
            fontSize: 15,
            fontFamily: SCREEN_FONTS.headline,
            color: theme.outline,
            textTransform: 'uppercase',
          }}
        >
          {STRINGS.session.status.past}
        </Text>
      </View>
    )
  }

  if (isDuringMatch) {
    return (
      <View
        style={{
          width: '100%',
          minHeight: 52,
          paddingVertical: 11,
          borderRadius: RADIUS.md,
          backgroundColor: theme.surfaceContainerHigh,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          borderWidth: BORDER.base,
          borderColor: theme.outlineVariant,
        }}
      >
        <ActivityIndicator size="small" color={theme.primary} />
        <Text
          style={{
            fontSize: 15,
            fontFamily: SCREEN_FONTS.headline,
            color: theme.onSurfaceVariant,
            textTransform: 'uppercase',
          }}
        >
          {STRINGS.session.labels.in_progress_match}
        </Text>
      </View>
    )
  }

  return null
}

export const SessionActionButtons: React.FC<SessionActionButtonsProps> = ({
  id,
  session,
  isHost,
  hasJoined,
  isAfterEnd,
  isDuringMatch,
  isCancelled,
  viewerSessionPlayer,
  hostPrimaryMode,
  hostPrimaryDisabled,
  hostActionBusy,
  savingArrangement,
  leaving,
  onSaveArrangement,
  leaveSession,
  onArrangementPress,
  checkInCompleted,
  hideArrangementCta,
  hideInputResult,
  matchesCount,
}) => {
  const theme = useAppTheme()
  const resultsStatus = session?.results_status
  const isFinalized = resultsStatus === 'finalized'
  const isPendingConfirm = resultsStatus === 'pending_confirmation' || resultsStatus === 'disputed'
  const hasRated = session?.has_rated
  
  const confirmedPlayerCount = (session?.session_players ?? []).filter((p: any) => p.status === 'confirmed').length
  const maxPlayers = Number(session?.max_players || 0)
  
  const hostDetails = session?.owner_sessions?.[0] || session?.owner_sessions || {}
  const matchFormat = hostDetails.match_format || 'doubles'
  const minPlayers = session?.min_players || (matchFormat === 'doubles' ? 4 : 2)
  
  const isEven = confirmedPlayerCount % 2 === 0
  const isValidCount = confirmedPlayerCount >= minPlayers && confirmedPlayerCount <= maxPlayers
    
  const sessionStatus = session?.status
  const isEnded = isAfterEnd || ['done', 'pending_completion', 'pending_results', 'completed', 'finished', 'archived', 'cancelled_no_players', 'failed_to_fill', 'cancelled'].includes(sessionStatus)
  const isInvalidPlayerCount = isEnded && !isValidCount && !checkInCompleted
  const isPartialPlayerCount = isEnded && (isValidCount || checkInCompleted) && confirmedPlayerCount < maxPlayers

  const isResultSubmitted = resultsStatus === 'pending_confirmation' || resultsStatus === 'disputed'
  const isAwaitingResult = isAfterEnd && (resultsStatus === 'not_submitted' || resultsStatus === null || resultsStatus === undefined)

  // 1. Banner Routing (Cancelled or Invalid state)
  const showBanner = isCancelled || (isInvalidPlayerCount && !isFinalized && !isPendingConfirm)
  
  // 2. Main Logic Routing
  return (
    <View style={{ width: '100%' }}>
      {showBanner && (
        <SessionStatusBanner 
          isCancelled={isCancelled}
          isInvalidPlayerCount={isInvalidPlayerCount}
          hasJoined={hasJoined}
          isFinalized={isFinalized}
          isAfterEnd={isAfterEnd}
          checkInCompleted={checkInCompleted}
          matchesCount={matchesCount}
          theme={theme}
        />
      )}

      {/* If host or banner shown, some cases return early or fall through. 
          The sub-components handle their own state-based rendering. */}
      {isHost ? (
        (!showBanner || hasJoined) && (
          <HostActions 
            id={id}
            session={session}
            isAfterEnd={isAfterEnd}
            isDuringMatch={isDuringMatch}
            isFinalized={isFinalized}
            isResultSubmitted={isResultSubmitted}
            isAwaitingResult={isAwaitingResult}
            isPartialPlayerCount={isPartialPlayerCount}
            isInvalidPlayerCount={isInvalidPlayerCount}
            confirmedPlayerCount={confirmedPlayerCount}
            maxPlayers={maxPlayers}
            hasRated={hasRated}
            hostPrimaryMode={hostPrimaryMode}
            hostPrimaryDisabled={hostPrimaryDisabled}
            savingArrangement={savingArrangement}
            leaving={leaving}
            hostActionBusy={hostActionBusy}
            onSaveArrangement={onSaveArrangement}
            leaveSession={leaveSession}
            onArrangementPress={onArrangementPress}
            checkInCompleted={checkInCompleted}
            hideArrangementCta={hideArrangementCta}
            isCancelled={isCancelled}
            theme={theme}
          />
        )
      ) : hasJoined ? (
        <PlayerActions 
          id={id}
          session={session}
          isAfterEnd={isAfterEnd}
          isDuringMatch={isDuringMatch}
          isFinalized={isFinalized}
          isPendingConfirm={isPendingConfirm}
          isInvalidPlayerCount={isInvalidPlayerCount}
          hasRated={hasRated}
          viewerSessionPlayer={viewerSessionPlayer}
          leaving={leaving}
          leaveSession={leaveSession}
          theme={theme}
        />
      ) : (
        <PublicActions 
          isEnded={isEnded}
          isDuringMatch={isDuringMatch}
          theme={theme}
        />
      )}
    </View>
  )
}
