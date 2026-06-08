import { useLocalSearchParams } from 'expo-router'
import { useSessionDetail } from '@/hooks/useSessionDetail'
import { useAuth } from '@/lib/useAuth'
import { AppLoading } from '@/components/design'
import { PlayerSessionDetailScreen } from '@/features/player/session-detail/PlayerSessionDetailScreen'

export default function SessionDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { userId } = useAuth()

  const {
    loading,
    refreshing,
    session,
    viewerPlayer,
    requestStatus,
    setRequestStatus,
    setHostResponseTemplate,
    introNote,
    setIntroNote,
    hostResponseTemplate,
    fetchSession,
    onRefresh,
    error,
  } = useSessionDetail(id, userId)

  const hasJoined = session ? session.session_players.some((item: any) => item.player_id === userId) : false

  if (loading) {
    return <AppLoading fullScreen />
  }

  if (!session) {
    return null
  }

  return (
    <PlayerSessionDetailScreen
      id={id!}
      session={session}
      viewerPlayer={viewerPlayer}
      refreshing={refreshing}
      onRefresh={onRefresh}
      userId={userId ?? null}
      matches={[]} 
      introNote={introNote}
      setIntroNote={setIntroNote}
      hostResponseTemplate={hostResponseTemplate}
      requestStatus={requestStatus}
      setRequestStatus={setRequestStatus}
      setHostResponseTemplate={setHostResponseTemplate}
      refreshSession={fetchSession}
    />
  )
}
