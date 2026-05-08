import React, { useEffect, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { Plus } from 'lucide-react-native'
import { useAppNav } from '@/lib/navigation/AppNavContext'
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withTiming, 
  withRepeat, 
  withSequence 
} from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { STRINGS } from '@/constants/strings'
const canHaptics = Platform.OS !== 'web'

interface ExpandingCreateButtonProps {
  isFAB?: boolean
}

export function ExpandingCreateButton({ isFAB = false }: ExpandingCreateButtonProps) {
  const theme = useAppTheme()
  const { onCreateSession } = useAppNav()
  const [expanded, setExpanded] = useState(false)
  
  // Dimensions based on context
  const size = isFAB ? 60 : 44
  const expandedWidth = isFAB ? 180 : 120 // Reduced width to prevent header wrap
  const iconSize = isFAB ? 28 : 20
  const fontSize = isFAB ? 16 : 13
  const paddingRight = isFAB ? 20 : 12

  const width = useSharedValue(size)
  const opacity = useSharedValue(0)
  const scale = useSharedValue(1)

  useEffect(() => {
    if (!expanded) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 1000 }),
          withTiming(1, { duration: 1000 })
        ),
        -1,
        true
      )
    } else {
      scale.value = withSpring(1, { damping: 20 })
    }
  }, [expanded])

  const animatedStyle = useAnimatedStyle(() => ({
    width: width.value,
    transform: [{ scale: scale.value }]
  }))

  const textStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }))

  const handlePress = async () => {
    if (!expanded) {
      setExpanded(true)
      try {
        if (!canHaptics) throw new Error('no-haptics-on-web')
        await Haptics.selectionAsync()
      } catch {}

      width.value = withSpring(expandedWidth, { damping: 15, stiffness: 100 })
      opacity.value = withTiming(1, { duration: 250 })

      setTimeout(() => {
        setExpanded((curr) => {
          if (curr) {
            width.value = withSpring(size)
            opacity.value = withTiming(0)
            return false
          }
          return curr
        })
      }, 3500)
    } else {
      try {
        if (!canHaptics) throw new Error('no-haptics-on-web')
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      } catch {}

      onCreateSession()
      
      setTimeout(() => {
        width.value = size
        opacity.value = 0
        setExpanded(false)
      }, 500)
    }
  }

  return (
    <Pressable 
      onPress={handlePress}
      style={isFAB ? {
        position: 'absolute',
        bottom: 100,
        right: 24,
        zIndex: 1000,
      } : {}}
    >
      <Animated.View
        className="flex-row items-center overflow-hidden"
        style={[
          {
            height: size,
            borderRadius: 999, // FAB remains circular as requested
            backgroundColor: theme.primary,
            shadowColor: theme.primary,
            shadowOpacity: isFAB ? 0.4 : 0.25,
            shadowRadius: isFAB ? 15 : 10,
            shadowOffset: { width: 0, height: isFAB ? 6 : 4 },
            elevation: isFAB ? 8 : 4,
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.3)',
          },
          animatedStyle,
        ]}
      >
        <LinearGradient
          colors={[theme.primary, theme.surfaceTint]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Plus size={iconSize} color="#FFFFFF" strokeWidth={3} />
        </View>

        <Animated.View 
          style={[
            { 
              flex: 1, 
              paddingRight: paddingRight, 
              justifyContent: 'center',
            }, 
            textStyle
          ]}
        >
          <Text
            className="uppercase tracking-[1.2px]"
            numberOfLines={1}
            style={{ 
              color: '#FFFFFF', 
              fontFamily: SCREEN_FONTS.headlineBlack, 
              fontSize: fontSize,
              top: 1,
            }}
          >
            {isFAB ? STRINGS.home.actions.create_session : 'Tạo kèo'}
          </Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  )
}
