import {  MapPin, Zap, Star } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { Image } from 'expo-image'

import { RADIUS, SHADOW, SPACING, BORDER } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { FamiliarCourt } from '@/lib/homeFeed'
import { useAppTheme } from '@/lib/theme-context'

const iconStroke = 2.7
export const COURT_CARD_HEIGHT = 256

import { withAlpha } from '@/lib/utils/ui'
import { STRINGS } from '@/constants/strings'

export function FamiliarCourtCard({ item, onPress }: { item: FamiliarCourt; onPress?: () => void }) {
  const theme = useAppTheme()
  
  // Optimize image URL for thumbnail size (approx 600px width for quality on retina)
  const imageUrl = item.image?.includes('supabase') 
    ? `${item.image}${item.image.includes('?') ? '&' : '?'}width=600`
    : item.image

  return (
    <Pressable
      onPress={onPress}
      className="overflow-hidden active:scale-[0.99]"
      style={{ height: COURT_CARD_HEIGHT, borderRadius: RADIUS.lg, ...SHADOW.sm }}
    >
      <View style={{ flex: 1, backgroundColor: theme.surfaceContainerHigh }}>
        <Image
          source={imageUrl}
          placeholder={item.thumbnail_url}
          contentFit="cover"
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />
        
        {/* Dark Overlay for text legibility */}
        <View 
          style={{ 
            position: 'absolute', 
            top: 0, bottom: 0, left: 0, right: 0, 
            backgroundColor: 'rgba(0,0,0,0.15)',
            padding: SPACING.xl,
            justifyContent: 'space-between'
          }}
        >
          <View className="flex-row items-start justify-end">
            {item.openMatches > 0 && (
              <View
                className="flex-row items-center"
                style={{
                  borderRadius: RADIUS.full,
                  borderWidth: BORDER.base,
                  paddingHorizontal: SPACING.lg,
                  paddingVertical: SPACING.sm,
                  borderColor: theme.primaryFixed,
                  backgroundColor: theme.surfaceContainerLowest,
                  ...SHADOW.sm,
                }}
              >
                <Zap size={16} color={theme.primary} strokeWidth={3} />
                <Text
                  className="ml-2 text-sm uppercase"
                  style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, letterSpacing: 0.5 }}
                >
                  {STRINGS.home.status.open_matches.replace('{count}', item.openMatches.toString())}
                </Text>
              </View>
            )}
          </View>

          <View
            style={{
              borderRadius: RADIUS.md + 4,
              borderWidth: BORDER.base,
              paddingHorizontal: SPACING.md,
              paddingVertical: SPACING.sm + 2,
              borderColor: withAlpha(theme.onPrimary, 0.7),
              backgroundColor: withAlpha(theme.onPrimary, 0.9),
              ...SHADOW.lg,
            }}
          >
            <View className="flex-row items-start justify-between">
              <Text
                className="flex-1 text-[19px]"
                numberOfLines={2}
                ellipsizeMode="tail"
                style={{ 
                  color: theme.onSurface, 
                  fontFamily: SCREEN_FONTS.headline,
                  includeFontPadding: false,
                  lineHeight: 24
                }}
              >
                {item.name}
              </Text>
              {item.rating != null && (
                <View className="ml-3 flex-row items-center" style={{ marginTop: 2 }}>
                  <Star size={13} color="#F59E0B" fill="#F59E0B" />
                  <Text
                    className="ml-1 text-sm font-bold"
                    style={{ 
                      color: theme.onSurface, 
                      fontFamily: SCREEN_FONTS.headline,
                      includeFontPadding: false
                    }}
                  >
                    {item.rating.toFixed(1)}
                  </Text>
                </View>
              )}
            </View>

            <View className="mt-1 flex-row items-center">
              <MapPin size={12} color={theme.onSurfaceVariant} strokeWidth={iconStroke} />
              <Text
                className="ml-1.5 flex-1 text-[12px]"
                numberOfLines={1}
                style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label }}
              >
                {item.area}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  )
}

