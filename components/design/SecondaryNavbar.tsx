import { useAppTheme } from '@/lib/theme-context'
import {  SPACING } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { router } from 'expo-router'
import { ChevronLeft, Upload } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Image, Platform, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'

type SecondaryNavbarProps = {
  title?: string
  rightSlot?: ReactNode
  progress?: number // 0 to 1
  showProgress?: boolean
  onBackPress?: () => void
  style?: any
  hideBackButton?: boolean
}

const NAVBAR_HEIGHT = 58
const canHaptics = Platform.OS !== 'web'

/**
 * Standard Navbar for 2nd level+ screens (Detail, Flow, Edit, etc.)
 * Background: surfaceAlt, Height: 58px, Brand centered.
 */
export function SecondaryNavbar({
  title,
  rightSlot,
  progress,
  showProgress = false,
  onBackPress,
  style,
  hideBackButton = false,
}: SecondaryNavbarProps) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const handleBack = onBackPress || (() => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/')
    }
  })

  return (
    <View style={[{ backgroundColor: theme.surfaceAlt, zIndex: 100, paddingTop: insets.top }, style]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: NAVBAR_HEIGHT,
          paddingTop: SPACING.sm,
          paddingHorizontal: SPACING.xl,
          paddingBottom: SPACING.sm,
          borderBottomWidth: 0.5,
          borderBottomColor: theme.outlineVariant,
        }}
      >
        {/* Left Slot: Back Button */}
        {!hideBackButton ? (
          <Pressable
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => {
              if (canHaptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              handleBack()
            }}
            style={{
              height: 36,
              width: 36,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              borderWidth: 1,
              backgroundColor: theme.surface,
              borderColor: theme.outlineVariant,
            }}
          >
            <ChevronLeft size={16} color={theme.onBackground} strokeWidth={3} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}

        {/* Center Slot: Brand Name or Title */}
        <View 
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            alignItems: 'center',
            justifyContent: 'center',
            height: NAVBAR_HEIGHT,
            zIndex: -1,
          }}
          pointerEvents="none"
        >
          <Text
            style={{
              fontFamily: SCREEN_FONTS.headlineBlack,
              fontSize: 24,
              color: theme.primary,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}
          >
            {title || 'PICKLEMATCH'}
          </Text>
        </View>

        {/* Right Slot: Contextual Action */}
        <View style={{ height: 36, alignItems: 'center', justifyContent: 'center' }}>
          {rightSlot || <View style={{ width: 36 }} />}
        </View>
      </View>

      {/* Progress Bar (Optional) */}
      {showProgress && progress !== undefined && (
        <View style={{ height: 3, backgroundColor: theme.outlineVariant, width: '100%' }}>
          <View
            style={{
              height: '100%',
              backgroundColor: theme.primary,
              width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
            }}
          />
        </View>
      )}
    </View>
  )
}

/**
 * Common Right Slot Components
 */

export const NavbarShareButton = ({ onPress }: { onPress: () => void }) => {
  const theme = useAppTheme()
  return (
    <Pressable
      onPress={() => {
        if (canHaptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        onPress()
      }}
      style={{
        height: 36,
        width: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        backgroundColor: theme.surface,
        borderColor: theme.outlineVariant,
      }}
    >
      <Upload size={16} color={theme.onBackground} strokeWidth={2.5} />
    </Pressable>
  )
}

export const NavbarUserAvatar = ({ url, name }: { url?: string | null; name?: string | null }) => {
  const theme = useAppTheme()
  const initial = name?.trim().charAt(0).toUpperCase() || '?'
  
  return (
    <View
      style={{
        height: 36,
        width: 36,
        overflow: 'hidden',
        borderRadius: 999,
        backgroundColor: theme.primary,
      }}
    >
      {url ? (
        <Image source={{ uri: url }} style={{ height: '100%', width: '100%' }} resizeMode="cover" />
      ) : (
        <View style={{ height: '100%', width: '100%', alignItems: 'center', justifyContent: 'center' }}>
          <Text 
            style={{ 
              color: theme.surface, 
              fontFamily: SCREEN_FONTS.headline, 
              fontSize: 14,
              lineHeight: 18
            }}
          >
            {initial}
          </Text>
        </View>
      )}
    </View>
  )
}

export const NavbarDoneButton = ({ onPress, disabled = false }: { onPress: () => void; disabled?: boolean }) => {
  const theme = useAppTheme()
  return (
    <Pressable
      onPress={() => {
        if (canHaptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        onPress()
      }}
      disabled={disabled}
      style={{
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 6,
        backgroundColor: theme.secondaryContainer,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Text
        style={{
          color: theme.primary,
          fontFamily: SCREEN_FONTS.label,
          fontSize: 11,
          textTransform: 'uppercase',
        }}
      >
        Hoàn tất
      </Text>
    </Pressable>
  )
}

export const NavbarStepCounter = ({ current, total }: { current: number; total: number }) => {
  const theme = useAppTheme()
  return (
    <View style={{ height: 36, alignItems: 'center', justifyContent: 'center' }}>
      <Text
        style={{
          color: theme.outline,
          fontFamily: SCREEN_FONTS.label,
          fontSize: 11,
        }}
      >
        {current} / {total}
      </Text>
    </View>
  )
}
