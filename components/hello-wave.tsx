import { Hand } from 'lucide-react-native'
import Animated from 'react-native-reanimated'
import { View } from 'react-native'
import React from 'react'
import { useAppTheme } from '@/lib/theme-context'

export function HelloWave() {
  const theme = useAppTheme()
  return (
    <Animated.View
      style={{
        marginTop: -6,
        // Using a simpler animation approach if web-style animation names aren't standard in all RN environments
        // But keeping the intent
      }}
    >
      <View>
        <Hand size={28} color={theme.onBackground} />
      </View>
    </Animated.View>
  )
}



