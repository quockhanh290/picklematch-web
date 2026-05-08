import { SCREEN_FONTS } from '@/constants/typography'
import { router } from 'expo-router'
import { Image, Pressable, Text, View, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SPACING, RADIUS, BORDER, SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { useAppTheme } from '@/lib/theme-context'
import { WebContainer } from '@/components/design/WebContainer'
import { Settings, Star, Zap } from 'lucide-react-native'

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
        paddingTop: isWeb ? 20 : (insets.top + SPACING.sm),
        paddingBottom: 20,
        backgroundColor: 'transparent',
      }}
    >
      <WebContainer>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* Left Content */}
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text
              style={{ 
                color: '#8B8678',
                fontFamily: SCREEN_FONTS.body, 
                fontSize: 12,
                marginBottom: 2
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
                letterSpacing: -1,
                textTransform: 'uppercase',
                marginBottom: 8
              }}
            >
              {displayName}
            </Text>

            {/* Status & Stats Row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <View style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                backgroundColor: theme.primaryContainer, 
                paddingHorizontal: 8, 
                paddingVertical: 3, 
                borderRadius: RADIUS.full,
                gap: 4,
              }}>
                <Zap size={10} color={theme.primary} fill={theme.primary} />
                <Text style={{ 
                  color: theme.primary, 
                  fontFamily: SCREEN_FONTS.headline, 
                  fontSize: 10,
                }}>
                  Host chuyên nghiệp
                </Text>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Star size={12} color="#FBBF24" fill="#FBBF24" />
                <Text style={{ 
                  color: '#8B8678', 
                  fontFamily: SCREEN_FONTS.medium, 
                  fontSize: 12 
                }}>
                  {rating} · {sessionCount} kèo
                </Text>
              </View>
            </View>
          </View>

          {/* Right Content */}
          <View style={{ alignItems: 'flex-end', gap: 12 }}>
            {/* Top Actions: Switcher & Settings */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {/* Role Switcher Pill */}
              <View style={{ 
                flexDirection: 'row', 
                backgroundColor: 'white', 
                borderRadius: RADIUS.full, 
                padding: 2,
                borderWidth: 1,
                borderColor: '#F1EFE9',
              }}>
                <Pressable 
                  onPress={() => onRoleChange?.('host')}
                  style={{ 
                    paddingHorizontal: 12, 
                    paddingVertical: 4, 
                    borderRadius: RADIUS.full,
                    backgroundColor: role === 'host' ? theme.primary : 'transparent'
                  }}
                >
                  <Text style={{ 
                    color: role === 'host' ? 'white' : '#8B8678', 
                    fontFamily: SCREEN_FONTS.headline, 
                    fontSize: 10 
                  }}>
                    HOST
                  </Text>
                </Pressable>
                <Pressable 
                  onPress={() => onRoleChange?.('player')}
                  style={{ 
                    paddingHorizontal: 12, 
                    paddingVertical: 4, 
                    borderRadius: RADIUS.full,
                    backgroundColor: role === 'player' ? theme.primary : 'transparent'
                  }}
                >
                  <Text style={{ 
                    color: role === 'player' ? 'white' : '#8B8678', 
                    fontFamily: SCREEN_FONTS.headline, 
                    fontSize: 10 
                  }}>
                    PLAYER
                  </Text>
                </Pressable>
              </View>

              {/* Settings Icon Button */}
              <Pressable 
                onPress={() => router.push('/host/settings')}
                style={({ hovered }: any) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: 'white',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: '#F1EFE9',
                  transform: hovered ? 'scale(1.05)' : 'scale(1)',
                } as any)}
              >
                <Settings size={16} color="#1A2E2A" />
              </Pressable>
            </View>

            {/* Avatar */}
            <Pressable
              onPress={handlePhotoPress}
              style={({ hovered }: any) => ({
                height: isWeb ? 56 : 48,
                width: isWeb ? 56 : 48,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                borderRadius: 999,
                backgroundColor: theme.primary,
                borderWidth: 2,
                borderColor: 'white',
                transform: hovered ? 'scale(1.02)' : 'scale(1)',
              } as any)}
            >
              {profilePhotoUrl ? (
                <Image source={{ uri: profilePhotoUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headlineBlack, fontSize: isWeb ? 24 : 18 }}>
                  {initial}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </WebContainer>
    </View>
  )
}
