import React, { useState, useMemo } from 'react'
import * as Linking from 'expo-linking'
import { RefreshControl, ScrollView, Share, Text, View, Platform, TouchableOpacity } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Trophy, CheckCheck } from 'lucide-react-native'

import { AppDialog, type AppDialogConfig, SecondaryNavbar, NavbarShareButton, AppLoading } from '@/components/design'
import { useAppTheme } from '@/lib/theme-context'
import { FeaturedSessionCard } from '@/components/sessions/v2/SessionCards'
import { getStatusLabel, type MatchSession } from '@/lib/homeFeed'
import { HostRosterSection } from '@/features/host/session-detail/HostRosterSection'
import { SessionActionButtons } from '@/components/session/SessionActionButtons'
import { SmartJoinButton } from '@/components/session/SmartJoinButton'
import { JoinRequestModal } from '@/components/session/JoinRequestModal'
import { SessionResultBanner } from '@/components/session/SessionResultBanner'
import { useSessionJoinActions } from '@/hooks/useSessionJoinActions'
import { SCREEN_FONTS } from '@/constants/typography'
import { SPACING, RADIUS, SHADOW, BORDER } from '@/constants/screenLayout'
import { formatTimeRange, buildArrangementPlayers, formatPricePerPerson } from '@/lib/sessionDetail'
import { getEloBandForSessionRange } from '@/lib/eloSystem'
import { getSessionSkillLabel } from '@/lib/skillAssessment'
import { BrandedFooter } from '@/components/design/BrandedFooter'
import { WebContainer } from '@/components/design/WebContainer'
import { STRINGS } from '@/constants/strings'

interface PlayerSessionDetailScreenProps {
  id: string
  session: any
  viewerPlayer: any
  refreshing: boolean
  onRefresh: () => Promise<void>
  userId: string | null
  matches: any[]
  
  // Remove Join Action Props from here
  setIntroNote: (note: string) => void
  introNote: string
  hostResponseTemplate: string | null
  requestStatus: any
  setRequestStatus: (status: any) => void
  setHostResponseTemplate: (value: string | null) => void
  refreshSession: () => Promise<void>
}

export function PlayerSessionDetailScreen({
  id,
  session,
  viewerPlayer,
  refreshing,
  onRefresh,
  userId,
  matches,
  
  introNote,
  setIntroNote,
  hostResponseTemplate,
  requestStatus,
  setRequestStatus,
  setHostResponseTemplate,
  refreshSession,
}: PlayerSessionDetailScreenProps) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)
  const [joinModalVisible, setJoinModalVisible] = useState(false)
  const [showPlayerList, setShowPlayerList] = useState(true)

  const isHost = userId !== null && userId !== undefined && userId === session?.host.id
  const hasJoined = useMemo(
    () => (session ? session.session_players.some((item: any) => item.player_id === userId) : false),
    [session, userId],
  )

  const {
    requesting,
    leaving,
    matchStatus,
    hostRequiresApproval,
    requestStatus: joinRequestStatus,
    sendJoinRequest,
    cancelJoinRequest,
    canShowJoinActions,
    leaveSession,
    handleSmartJoinPress,
  } = useSessionJoinActions({
    session,
    userId,
    viewerPlayer,
    hasJoined,
    requestStatus,
    setRequestStatus,
    setHostResponseTemplate,
    introNote,
    onJoinModalClose: () => setJoinModalVisible(false),
    onJoinModalOpen: () => setJoinModalVisible(true),
    refreshSession,
    presentDialog: (config) => setDialogConfig(config),
  })

  const now = new Date().getTime()
  const startTs = new Date(session.slot.start_time).getTime()
  const endTs = new Date(session.slot.end_time).getTime()
  
  const isPast = endTs <= Date.now() || ['completed', 'finished', 'archived', 'done'].includes(session.status)
  const isDuringMatch = now >= startTs && now <= endTs
  const isCancelled = session.status === 'cancelled'
  
  const sessionSkillLabel = getSessionSkillLabel(session.elo_min, session.elo_max)
  const HostDetails = session.owner_sessions?.[0] || session.owner_sessions || {}
  const processedPlayers = buildArrangementPlayers({ ...session, owner_sessions: HostDetails })

  const handleShare = async () => {
    try {
      const url = Linking.createURL(`/session/${id}`)
      await Share.share({ message: STRINGS.session_detail.share_message.replace('{url}', url) })
    } catch (error) {
      console.warn('[PlayerSessionDetail] Failed to share session:', error)
      setDialogConfig({ title: STRINGS.session_detail.errors.share_failed, message: STRINGS.session_detail.share_failed_desc, actions: [{ label: STRINGS.common.back, tone: 'secondary' }] })
    }
  }

  const showBottomActions = isHost || hasJoined || canShowJoinActions || isPast || isCancelled
  const viewerSessionPlayer = session.session_players.find((item: any) => item.player_id === userId) ?? null

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }} testID="player-session-detail-screen">
      <SecondaryNavbar
        title={STRINGS.session_detail.title}
        rightSlot={<NavbarShareButton onPress={() => void handleShare()} />}
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
        <WebContainer>
          <FeaturedSessionCard session={session} />

          {session.is_ranked && (
            <View
              style={{
                marginTop: 16,
                borderRadius: RADIUS.lg,
                padding: 16,
                backgroundColor: theme.surfaceContainerLow,
                borderWidth: 1,
                borderColor: theme.outlineVariant,
                flexDirection: 'row',
                gap: 16,
                alignItems: 'center',
                ...SHADOW.xs
              }}
            >
              <View style={{ 
                width: 44, 
                height: 44, 
                borderRadius: RADIUS.md, 
                backgroundColor: theme.primaryContainer, 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                <Text style={{ fontSize: 24 }}>🏆</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: SCREEN_FONTS.headline, color: theme.primary }}>
                  {STRINGS.session_detail.elo_banner.title}
                </Text>
                <Text style={{ fontSize: 12, fontFamily: SCREEN_FONTS.body, color: theme.onSurfaceVariant, marginTop: 2 }}>
                  {STRINGS.session_detail.elo_banner.description}
                </Text>
              </View>
            </View>
          )}

          <View style={{ marginTop: 16 }}>
            <SessionResultBanner
              id={id}
              resultsStatus={session.results_status}
              isHost={isHost}
              isResultDisputed={session.results_status === 'disputed'}
              canRespondToResult={
                !isHost &&
                hasJoined &&
                viewerSessionPlayer?.status === 'confirmed' &&
                !['confirmed', 'disputed'].includes(viewerSessionPlayer?.result_confirmation_status) &&
                (session.status === 'pending_completion' || session.status === 'done')
              }
            />
          </View>

          {/* Player Roster Section using Host style */}
          <View style={{ marginTop: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18, color: theme.onSurface }}>{STRINGS.session_detail.roster_title}</Text>
            </View>
            
            <HostRosterSection
              players={processedPlayers}
              maxPlayers={session.max_players}
              sessionStatus={session.status}
              hostId={session.host.id}
              hideEmptySlots={false}
              requireApproval={session.require_approval}
              sessionId={id}
              checkInCompleted={session.check_in_completed}
              startTime={session.slot.start_time}
              isHost={isHost}
            />
          </View>

          {showBottomActions && (
            <View style={{ marginTop: 24 }}>
              <SessionActionButtons
                id={id}
                session={session}
                isHost={isHost}
                hasJoined={hasJoined}
                isAfterEnd={isPast}
                isDuringMatch={isDuringMatch}
                isCancelled={isCancelled}
                viewerSessionPlayer={viewerSessionPlayer}
                hostPrimaryMode="edit"
                hostPrimaryDisabled={false}
                hostActionBusy={false}
                savingArrangement={false}
                leaving={leaving}
                onSaveArrangement={() => {}}
                leaveSession={leaveSession}
              />

              {!isHost && canShowJoinActions && (
                <View style={{ marginTop: 12 }}>
                  <SmartJoinButton
                    matchStatus={matchStatus}
                    requestStatus={joinRequestStatus}
                    hostRequiresApproval={hostRequiresApproval}
                    hostResponseTemplate={hostResponseTemplate}
                    onCancel={() => void cancelJoinRequest()}
                    loading={requesting}
                    onPress={handleSmartJoinPress}
                  />
                </View>
              )}
            </View>
          )}
          
          <BrandedFooter />
        </WebContainer>
      </ScrollView>

      <JoinRequestModal
        visible={joinModalVisible}
        mode={matchStatus}
        introNote={introNote}
        setIntroNote={setIntroNote}
        loading={requesting}
        onClose={() => setJoinModalVisible(false)}
        onSubmit={() => {
          sendJoinRequest().then(() => setJoinModalVisible(false))
        }}
      />

      <AppDialog
        visible={Boolean(dialogConfig)}
        config={dialogConfig}
        onClose={() => setDialogConfig(null)}
      />
    </View>
  )
}
