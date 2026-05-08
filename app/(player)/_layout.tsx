import { Stack, useRouter } from 'expo-router'
import { SessionNavContext, SessionNavigation } from '@/lib/navigation/SessionNavContext'
import { AppNavContext, AppNavigation } from '@/lib/navigation/AppNavContext'

export default function PlayerLayout() {
  const router = useRouter()

  const sessionNav: SessionNavigation = {
    onOpenSession: (id) => router.push({ pathname: '/session/[id]', params: { id } } as any),
    onEditSession: (id) => router.push({ pathname: '/create-session', params: { editSessionId: id } }),
    onViewMatchResult: (id) => router.push({ pathname: '/match-result/[id]', params: { id } } as any),
    onRateSession: (id) => router.push({ pathname: '/rate-session/[id]', params: { id } } as any),
    onConfirmResult: (id) => router.push({ pathname: '/session/[id]/confirm-result', params: { id } } as any),
    onReviewSession: (id) => router.push({ pathname: '/session/[id]/review', params: { id } } as any),
    onOpenPlayerProfile: (id) => router.push({ pathname: '/player/[id]', params: { id } } as any),
    onOpenCourt: (id) => router.push({ pathname: '/court/[id]', params: { id } } as any),
  }

  const appNav: AppNavigation = {
    onOpenProfile: () => router.push('/(player)/(tabs)/profile' as any),
    onCreateSession: () => router.push('/create-session'),
  }

  return (
    <AppNavContext.Provider value={appNav}>
      <SessionNavContext.Provider value={sessionNav}>
        <Stack screenOptions={{ headerShown: false }} />
      </SessionNavContext.Provider>
    </AppNavContext.Provider>
  )
}
