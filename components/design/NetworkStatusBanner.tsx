import React, { useEffect, useRef } from 'react'
import { View, Text, StyleSheet, Animated, Pressable, Platform } from 'react-native'
import { useNetworkState } from '@/lib/NetworkContext'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { WifiOff, RefreshCw } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function NetworkStatusBanner() {
  const { status, retry } = useNetworkState()
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const anim = useRef(new Animated.Value(0)).current

  const visible = status !== 'online'

  useEffect(() => {
    Animated.spring(anim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 40,
      friction: 7
    }).start()
  }, [visible])

  if (!visible) return null

  const backgroundColor = status === 'offline' ? theme.errorContainer : theme.secondaryContainer
  const textColor = status === 'offline' ? theme.onErrorContainer : theme.onSecondaryContainer
  const icon = status === 'offline' ? <WifiOff size={14} color={textColor} /> : <RefreshCw size={14} color={textColor} />
  const message = status === 'offline' ? 'Bạn đang ngoại tuyến' : 'Kết nối chậm, đang thử lại...'

  return (
    <Animated.View 
      style={[
        styles.container, 
        { 
          position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute',
          backgroundColor,
          paddingTop: Platform.OS === 'ios' ? insets.top : 8,
          transform: [{
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [-100, 0]
            })
          }]
        }
      ]}
    >
      <View style={styles.content}>
        {icon}
        <Text style={[styles.text, { color: textColor }]}>{message}</Text>
        <Pressable onPress={retry} style={styles.retryButton}>
          <Text style={[styles.retryText, { color: textColor }]}>Thử lại</Text>
        </Pressable>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  text: {
    fontFamily: SCREEN_FONTS.label,
    fontSize: 12,
    fontWeight: '600',
  },
  retryButton: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  retryText: {
    fontFamily: SCREEN_FONTS.cta,
    fontSize: 10,
    textTransform: 'uppercase',
  }
})
