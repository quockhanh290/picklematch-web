import { SCREEN_FONTS } from '@/constants/typography'
import { router } from 'expo-router'
import { Image, Pressable, Text, View, Platform, TouchableOpacity } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SPACING, RADIUS, BORDER, SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { useAppTheme } from '@/lib/theme-context'
import { WebContainer } from '@/components/design/WebContainer'
import { Settings, Star, Plus } from 'lucide-react-native'

function getGreetingLabel() {
  const hour = new Date().getHours()

  if (hour >= 5 && hour <= 11) return `${STRINGS.home.greeting.morning} ☀️`
  if (hour >= 12 && hour <= 17) return `${STRINGS.home.greeting.afternoon} 🌤️`
  if (hour >= 18 && hour <= 21) return `${STRINGS.home.greeting.evening} 🌙`
  return `${STRINGS.home.greeting.default} 👋`
}

export function HomeGreetingHeader({
  name,
  role = 'player',
  onRoleChange,
  profilePhotoUrl,
  onPhotoPress,
  rating = 4.8,
  sessionCount = 47,
  isProfessional = true,
}: {
  name: string
  role?: 'host' | 'player'
  onRoleChange?: (role: 'host' | 'player') => void
  profilePhotoUrl?: string | null
  onPhotoPress?: () => void
  rating?: number
  sessionCount?: number
  isProfessional?: boolean
}) {
  const theme = useAppTheme()
  const displayName = name.trim() || 'Bạn'
  const initial = displayName.charAt(0).toUpperCase()
  const insets = useSafeAreaInsets()
  const isWeb = Platform.OS === 'web'

  const handlePhotoPress = onPhotoPress || (() => router.push('/(tabs)/profile' as never))

  return (
    <View
      style={{
        paddingTop: isWeb ? 32 : (insets.top + SPACING.md),
        paddingBottom: 32,
        backgroundColor: 'transparent',
      }}
    >
      <WebContainer>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Left Section: Avatar & Info */}
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            {/* Avatar */}
            <Pressable
              onPress={handlePhotoPress}
              style={({ hovered }: any) => ({
                height: isWeb ? 48 : 40,
                width: isWeb ? 48 : 40,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                borderRadius: 999,
                backgroundColor: theme.primary,
                borderWidth: 2,
                borderColor: 'white',
                marginRight: 12,
                transform: hovered ? 'scale(1.02)' : 'scale(1)',
                ...SHADOW.xs
              } as any)}
            >
              {profilePhotoUrl ? (
                <Image source={{ uri: profilePhotoUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headlineBlack, fontSize: isWeb ? 20 : 16 }}>
                  {initial}
                </Text>
              )}
            </Pressable>

            {/* Identity & Stats */}
            <View style={{ flex: 1 }}>
              <Text
                style={{ 
                  color: '#8B8678',
                  fontFamily: SCREEN_FONTS.body, 
                  fontSize: 13,
                  marginBottom: 1
                }}
              >
                {getGreetingLabel()}
              </Text>

              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{ 
                  color: '#1A2E2A', 
                  fontFamily: SCREEN_FONTS.headlineBlack, 
                  fontSize: isWeb ? 32 : 24,
                  lineHeight: isWeb ? 38 : 28, 
                  letterSpacing: -0.5,
                  textTransform: 'uppercase',
                  marginBottom: 4
                }}
              >
                {displayName}
              </Text>

            </View>
          </View>

          {/* Right Section: Primary Action */}
          <View style={{ alignItems: 'flex-end' }}>
            <TouchableOpacity
              onPress={() => router.push('/host/create-session')}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.primary,
                paddingHorizontal: 20,
                paddingVertical: 12,
                borderRadius: RADIUS.md,
                gap: 8,
                ...SHADOW.sm
              }}
            >
              <Plus size={18} color="white" strokeWidth={3} />
              <Text style={{ 
                color: 'white', 
                fontFamily: SCREEN_FONTS.headline, 
                fontSize: 14,
                letterSpacing: 0.5
              }}>
                TẠO KÈO MỚI
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </WebContainer>
    </View>
  )
}
