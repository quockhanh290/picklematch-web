import React from 'react'
import { ActivityIndicator, Pressable, Text, TouchableOpacity, View } from 'react-native'
import { RefreshCcw } from 'lucide-react-native'

import { BORDER, RADIUS } from '@/constants/screenLayout'
import { useAppTheme } from '@/lib/theme-context'

import { ctaTextStyle, eyebrowStyle } from './helpers'

export function NavbarRightActions({ onRefresh, refreshing }: { onRefresh: () => void; refreshing?: boolean }) {
  const theme = useAppTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable
        onPress={onRefresh}
        style={{
          height: 36,
          width: 36,
          borderRadius: RADIUS.full,
          borderWidth: BORDER.hairline,
          borderColor: theme.outlineVariant,
          backgroundColor: theme.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {refreshing ? <ActivityIndicator color={theme.primary} /> : <RefreshCcw size={16} color={theme.onSurface} />}
      </Pressable>
    </View>
  )
}

export function ChoiceRow<T extends string | number>({
  label,
  testID,
  options,
  value,
  onChange,
}: {
  label: string
  testID?: string
  options: Array<{ label: string; value: T }>
  value: T
  onChange: (value: T) => void
}) {
  const theme = useAppTheme()
  return (
    <View testID={testID} style={{ marginBottom: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(option => {
          const active = option.value === value
          return (
            <TouchableOpacity
              key={`${label}-${option.value}`}
              testID={testID ? `${testID}-option-${option.value}` : undefined}
              accessibilityState={{ selected: active }}
              onPress={() => onChange(option.value)}
              style={{
                minHeight: 40,
                minWidth: 62,
                borderRadius: RADIUS.md,
                backgroundColor: active ? theme.primary : theme.surface,
                borderWidth: BORDER.hairline,
                borderColor: active ? theme.primary : theme.outlineVariant,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 10,
              }}
            >
              <Text style={ctaTextStyle(active ? theme.onPrimary : theme.onSurface, 12)}>{option.label}</Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}
