import { Stack, useRouter } from 'expo-router'
import { SessionNavContext, SessionNavigation } from '@/lib/navigation/SessionNavContext'
import { AppNavContext, AppNavigation } from '@/lib/navigation/AppNavContext'

export default function OwnerLayout() {
  const router = useRouter()

  const sessionNav: SessionNavigation = {
    onOpenSession: (id) => router.push({ pathname: '/owner/session/[id]', params: { id } } as any),
    onEditSession: (id) => router.push({ pathname: '/owner/create-session', params: { editSessionId: id } }),
    onViewMatchResult: (id) => router.push({ pathname: '/owner/match-result/[id]', params: { id } } as any),
    onRateSession: (id) => {}, // Owner doesn't rate
    onConfirmResult: (id) => {}, // Owner doesn't confirm (they input)
    onReviewSession: (id) => {}, 
    onOpenPlayerProfile: (id) => router.push({ pathname: '/player/[id]', params: { id } } as any),
    onOpenCourt: (id) => router.push({ pathname: '/owner/court-config', params: { id } } as any),
  }

  const appNav: AppNavigation = {
    onOpenProfile: () => router.push('/owner/profile'),
    onCreateSession: () => router.push('/owner/create-session'),
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
