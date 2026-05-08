import { SCREEN_FONTS } from '@/constants/typography'
import { useAppNav } from '@/lib/navigation/AppNavContext'
import { Image, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SPACING } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { useAppTheme } from '@/lib/theme-context'

function getGreetingLabel() {
  const hour = new Date().getHours()

  if (hour >= 5 && hour <= 11) return `${STRINGS.home.greeting.morning} ☀️`
  if (hour >= 12 && hour <= 17) return `${STRINGS.home.greeting.afternoon} 🌤️`
  if (hour >= 18 && hour <= 21) return `${STRINGS.home.greeting.evening} 🌙`
  return `${STRINGS.home.greeting.default} 👋`
}

export function HomeGreetingHeader({
  name,
  statusPrompt,
  profilePhotoUrl,
}: {
  name: string
  statusPrompt: string
  profilePhotoUrl?: string | null
}) {
  const theme = useAppTheme()
  const displayName = name.trim() || 'Bạn'
  const initial = displayName.charAt(0).toUpperCase()
  const insets = useSafeAreaInsets()
  const { onOpenProfile } = useAppNav()

  return (
    <View
      style={{
        paddingTop: insets.top + SPACING.xl,
        paddingHorizontal: SPACING.xl,
        paddingBottom: 16,
        backgroundColor: theme.background,
      }}
    >
      <View className="flex-row items-center justify-between">
      <View className="min-w-0 flex-1 pr-4">
        <Text
          className="mb-[3px] text-[11px]"
          style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, lineHeight: 15 }}
        >
          {getGreetingLabel()}
        </Text>

        <Text
          className="text-[40px] uppercase"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ 
            color: theme.onBackground, 
            fontFamily: SCREEN_FONTS.headlineBlack, 
            lineHeight: 54, 
            letterSpacing: -1 
          }}
        >
          {displayName.toUpperCase()}
        </Text>

        <Text
          className="mt-1 text-[12px]"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, lineHeight: 17 }}
        >
          {statusPrompt}
        </Text>
      </View>

      <Pressable
        onPress={onOpenProfile}
        className="h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2"
        style={{ 
          backgroundColor: theme.primary, 
          borderColor: theme.outlineVariant
        }}
      >
        {profilePhotoUrl ? (
          <Image source={{ uri: profilePhotoUrl }} className="h-full w-full" resizeMode="cover" />
        ) : (
          <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 24, lineHeight: 28 }}>
            {initial}
          </Text>
        )}
      </Pressable>
      </View>
    </View>
  )
}

