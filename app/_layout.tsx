import { NotificationsProvider } from '@/lib/NotificationsContext'
import { AppThemeProvider } from '@/lib/theme-context'
import { useAuth } from '@/lib/useAuth'
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular'
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium'
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold'
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold'
import { PlusJakartaSans_800ExtraBold_Italic } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold_Italic'
import { useFonts } from 'expo-font'
import { Stack, useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SCREEN_FONTS } from '@/constants/typography'

import { SessionNavContext, SessionNavigation } from '@/lib/navigation/SessionNavContext'

import { AuthGate } from '@/features/player/auth/AuthGate'

void SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const { userId } = useAuth()
  const router = useRouter()
  const [fontsLoaded] = useFonts({
    [SCREEN_FONTS.headline]: require('@expo-google-fonts/barlow-condensed/BarlowCondensed_700Bold.ttf'),
    [SCREEN_FONTS.headlineItalic]: require('@expo-google-fonts/barlow-condensed/BarlowCondensed_700Bold_Italic.ttf'),
    [SCREEN_FONTS.headlineBlack]: require('@expo-google-fonts/barlow-condensed/BarlowCondensed_900Black.ttf'),
    [SCREEN_FONTS.body]: PlusJakartaSans_400Regular,
    [SCREEN_FONTS.medium]: PlusJakartaSans_500Medium,
    [SCREEN_FONTS.label]: PlusJakartaSans_600SemiBold,
    [SCREEN_FONTS.bold]: PlusJakartaSans_800ExtraBold,
    [SCREEN_FONTS.boldItalic]: PlusJakartaSans_800ExtraBold_Italic,
  })
  const fontsReadyForRender = Platform.OS === 'web' ? true : fontsLoaded

  useEffect(() => {
    if (fontsReadyForRender) {
      SplashScreen.hideAsync()
    }
  }, [fontsReadyForRender])

  const sessionNav: SessionNavigation = {
    onOpenSession: (id) => router.push({ pathname: '/host/session/[id]', params: { id } } as any),
    onEditSession: (id) => router.push({ pathname: '/host/create-session', params: { editSessionId: id } }),
    onViewMatchResult: (id) => router.push({ pathname: '/host/match-result/[id]', params: { id } } as any),
    onRateSession: (id) => router.push(`/rate-session/${id}` as any),
    onConfirmResult: (id) => router.push(`/session/${id}/confirm-result` as any),
    onReviewSession: (id) => router.push(`/session/${id}/review` as any),
    onOpenPlayerProfile: (id) => router.push({ pathname: '/player/[id]', params: { id } } as any),
    onOpenCourt: (id) => router.push({ pathname: '/host/court-config', params: { id } } as any),
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider>
        <NotificationsProvider userId={userId}>
            <SessionNavContext.Provider value={sessionNav}>
              <AuthGate fontsLoaded={fontsReadyForRender}>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(player)" options={{ headerShown: false }} />
                  <Stack.Screen name="host" options={{ headerShown: false }} />
                  <Stack.Screen name="player/[id]" options={{ headerShown: false }} />
                </Stack>
              </AuthGate>
            </SessionNavContext.Provider>
        </NotificationsProvider>
      </AppThemeProvider>
    </GestureHandlerRootView>
  )
}
