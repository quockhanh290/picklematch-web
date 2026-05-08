import { ActivityIndicator, View, ViewStyle, StyleSheet, Text } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'

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

  const content = (
    <>
      <ActivityIndicator size={size} color={activeColor} />
      {label ? (
        <Text 
          style={{ 
            marginTop: 12, 
            fontSize: 14, 
            color: theme.onSurfaceVariant, 
            fontFamily: SCREEN_FONTS.headline,
            textAlign: 'center'
          }}
        >
          {label}
        </Text>
      ) : null}
    </>
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  }
})

