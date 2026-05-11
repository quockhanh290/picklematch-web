import React, { useEffect, useRef } from 'react'
import { Animated, View, ViewStyle, StyleSheet, Text, Platform } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS } from '@/constants/screenLayout'

interface AppLoadingProps {
  size?: 'small' | 'large'
  color?: string
  fullScreen?: boolean
  label?: string
  style?: ViewStyle
}

export function AppLoading({ 
  size = 'large', 
  color, 
  fullScreen = false,
  label,
  style 
}: AppLoadingProps) {
  const theme = useAppTheme()
  const activeColor = color || theme.primary
  const pulseAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    )
    pulse.start()
    return () => pulse.stop()
  }, [])

  const content = (
    <View style={styles.contentContainer}>
      <Animated.View style={[
        styles.logoContainer, 
        { 
          borderColor: activeColor,
          transform: [{ scale: pulseAnim }]
        }
      ]}>
        <View style={[styles.innerCircle, { backgroundColor: activeColor }]}>
          <Text style={styles.logoText}>PM</Text>
        </View>
      </Animated.View>
      
      <Text 
        style={{ 
          marginTop: 24, 
          fontSize: 12, 
          color: theme.primary, 
          fontFamily: SCREEN_FONTS.headlineBlack,
          textAlign: 'center',
          letterSpacing: 2.5,
          textTransform: 'uppercase'
        }}
      >
        {label || 'PICKLEMATCH'}
      </Text>
      
      {label && label !== 'PICKLEMATCH' && (
        <Text style={{
          marginTop: 8,
          fontSize: 13,
          color: theme.onSurfaceVariant,
          fontFamily: SCREEN_FONTS.body,
          textAlign: 'center'
        }}>
          {label}
        </Text>
      )}
    </View>
  )

  if (fullScreen) {
    return (
      <View style={[styles.fullScreen, { backgroundColor: theme.background }, style]}>
        {content}
      </View>
    )
  }

  return (
    <View style={[styles.container, style]}>
      {content}
    </View>
  )
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    position: Platform.OS === 'web' ? 'fixed' : 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  container: {
    padding: 40,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 200,
  },
  contentContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1.5,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerCircle: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: 'white',
    fontFamily: SCREEN_FONTS.headlineBlack,
    fontSize: 28,
    letterSpacing: -1,
  }
})

