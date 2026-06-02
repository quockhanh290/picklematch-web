import React from 'react'
import { router } from 'expo-router'
import { ActivityIndicator, Pressable, Text, TouchableOpacity, View, Platform } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MoreHorizontal, RefreshCcw } from 'lucide-react-native'

import { BORDER, RADIUS } from '@/constants/screenLayout'
import { useAppTheme } from '@/lib/theme-context'

import { ctaTextStyle, eyebrowStyle } from './helpers'

export function NavbarRightActions({ sessionId, onRefresh, refreshing }: { sessionId: string; onRefresh: () => void; refreshing?: boolean }) {
  const theme = useAppTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable
        onPress={() => router.push({ pathname: '/host/session/[id]/next-round', params: { id: sessionId, ui: 'v1' } })}
        style={{
          height: 36,
          minWidth: 46,
          borderRadius: RADIUS.full,
          borderWidth: BORDER.hairline,
          borderColor: theme.outlineVariant,
          backgroundColor: theme.surface,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 10,
        }}
      >
        <Text style={ctaTextStyle(theme.primary, 11)}>V1</Text>
      </Pressable>
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

export function StickyRoundCta({
  busy,
  primaryLabel,
  onPrimary,
  disabled,
  computing,
  onMore,
}: {
  busy: string | null
  primaryLabel: string
  onPrimary: () => void
  disabled?: boolean
  computing?: boolean
  onMore: () => void
}) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const isActionBusy = busy === 'start'
    || busy === 'end'
    || busy === 'suggest-match'
    || Boolean(busy?.startsWith('start-match-'))
    || Boolean(busy?.startsWith('complete-match-'))
    || Boolean(busy?.startsWith('cancel-match-'))
  return (
    <LinearGradient
      pointerEvents="box-none"
      colors={['rgba(255,251,245,0)', theme.background]}
      style={{ position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any, left: 0, right: 0, bottom: 0, paddingTop: 26, paddingHorizontal: 16, paddingBottom: 16 + insets.bottom }}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity
          testID="nrv2-cta-more"
          onPress={onMore}
          style={{ width: 48, height: 52, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center' }}
        >
          <MoreHorizontal size={22} color={theme.onSurface} />
        </TouchableOpacity>
        <TouchableOpacity
          testID="nrv2-cta-primary"
          onPress={onPrimary}
          disabled={disabled || isActionBusy}
          style={{ flex: 1, height: 52, borderRadius: RADIUS.md, backgroundColor: disabled ? theme.outlineVariant : theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          {isActionBusy
            ? <ActivityIndicator color={theme.onPrimary} />
            : computing
              ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color={theme.onPrimary} />
                  <Text style={ctaTextStyle(theme.onPrimary)}>Đang tính...</Text>
                </View>
              : <Text style={ctaTextStyle(theme.onPrimary)}>{primaryLabel}</Text>}
        </TouchableOpacity>
      </View>
    </LinearGradient>
  )
}

export function ChoiceRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ label: string; value: T }>
  value: T
  onChange: (value: T) => void
}) {
  const theme = useAppTheme()
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[eyebrowStyle(theme.outline), { marginBottom: 8 }]}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(option => {
          const active = option.value === value
          return (
            <TouchableOpacity
              key={`${label}-${option.value}`}
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
