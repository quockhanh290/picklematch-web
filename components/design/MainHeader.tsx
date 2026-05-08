import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { ReactNode } from 'react'
import { Text, View, ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SPACING } from '@/constants/screenLayout'

interface MainHeaderProps {
  title: string
  subtitle?: string
  brandedSubtitle?: string
  rightElement?: ReactNode
  style?: ViewStyle
}

export function MainHeader({ title, subtitle, brandedSubtitle, rightElement, style }: MainHeaderProps) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()

  return (
    <View
      style={[
        {
          paddingTop: insets.top + 20,
          paddingHorizontal: SPACING.xl,
          paddingBottom: 16,
          backgroundColor: theme.background,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: 16 }}>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{
              color: theme.onBackground,
              fontFamily: SCREEN_FONTS.headlineBlack,
              fontSize: 40,
              lineHeight: 50,
              letterSpacing: -1,
              textTransform: 'uppercase',
            }}
          >
            {title}
          </Text>
          {brandedSubtitle ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 0 }}>
              <View style={{ width: 14, height: 2, backgroundColor: theme.primary, marginRight: 8 }} />
              <Text
                style={{
                  color: theme.primary,
                  fontFamily: SCREEN_FONTS.headlineBlack,
                  fontSize: 12,
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                }}
              >
                <Text style={{ fontFamily: SCREEN_FONTS.medium, fontSize: 8, textTransform: 'none' }}>powered by </Text>
                {brandedSubtitle}
              </Text>
            </View>
          ) : subtitle ? (
            <Text
              style={{
                color: theme.onSurfaceVariant,
                fontFamily: SCREEN_FONTS.body,
                fontSize: 13,
                marginTop: -2,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {rightElement ? (
          <View style={{ marginTop: 6 }}>
            {rightElement}
          </View>
        ) : null}
      </View>
    </View>
  )
}

