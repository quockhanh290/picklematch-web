import { Stack, useRouter } from 'expo-router'
import { SessionNavContext, SessionNavigation } from '@/lib/navigation/SessionNavContext'
import { AppNavContext, AppNavigation } from '@/lib/navigation/AppNavContext'

export default function HostLayout() {
  const router = useRouter()

  const sessionNav: SessionNavigation = {
    onOpenSession: (id) => router.push({ pathname: '/host/session/[id]', params: { id } } as any),
    onEditSession: (id) => router.push({ pathname: '/host/create-session', params: { editSessionId: id } }),
    onViewMatchResult: (id) => router.push({ pathname: '/host/match-result/[id]', params: { id } } as any),
    onRateSession: (id) => {}, // Host doesn't rate
    onConfirmResult: (id) => {}, // Host doesn't confirm (they input)
    onReviewSession: (id) => {}, 
    onOpenPlayerProfile: (id) => router.push({ pathname: '/player/[id]', params: { id } } as any),
    onOpenCourt: (id) => router.push({ pathname: '/host/court-config', params: { id } } as any),
  }

  const appNav: AppNavigation = {
    onOpenProfile: () => router.push('/host/profile'),
    onCreateSession: () => router.push('/host/create-session'),
  }

  return (
    <AppNavContext.Provider value={appNav}>
      <SessionNavContext.Provider value={sessionNav}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="create-session" />
          <Stack.Screen name="session/[id]" />
          <Stack.Screen name="profile" />
        </Stack>
      </SessionNavContext.Provider>
    </AppNavContext.Provider>
  )
}
