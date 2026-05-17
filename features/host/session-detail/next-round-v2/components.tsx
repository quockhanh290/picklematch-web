import React from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BORDER, RADIUS, SHADOW } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import { useAppTheme } from '@/lib/theme-context'

import { ctaTextStyle, initials } from './helpers'

export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  const theme = useAppTheme()
  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: RADIUS.lg,
          borderWidth: BORDER.hairline,
          borderColor: theme.outlineVariant,
          ...SHADOW.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

export function PlayerAvatar({ name, size = 30 }: { name: string; size?: number }) {
  const theme = useAppTheme()
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: RADIUS.full,
        backgroundColor: theme.secondaryContainer,
        borderWidth: BORDER.hairline,
        borderColor: theme.outlineVariant,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: Math.max(10, size * 0.34), color: theme.primary }}>
        {initials(name)}
      </Text>
    </View>
  )
}

export function NextRoundSheet({
  visible,
  onClose,
  children,
  snap,
  scroll = true,
}: {
  visible: boolean
  onClose: () => void
  children: React.ReactNode
  snap: '50' | '88'
  scroll?: boolean
}) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: theme.overlay }} />
      <View
        style={{
          maxHeight: snap === '88' ? '88%' : '54%',
          minHeight: snap === '88' ? '60%' : '40%',
          backgroundColor: theme.background,
          borderTopLeftRadius: RADIUS.hero,
          borderTopRightRadius: RADIUS.hero,
          paddingTop: 10,
          paddingHorizontal: 16,
          paddingBottom: 16 + insets.bottom,
        }}
      >
        <View style={{ width: 44, height: 5, borderRadius: RADIUS.full, backgroundColor: theme.outlineVariant, alignSelf: 'center', marginBottom: 12 }} />
        {scroll ? (
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
        ) : (
          <View style={{ flex: 1 }}>{children}</View>
        )}
      </View>
    </Modal>
  )
}

export function SheetTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const theme = useAppTheme()
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 24, color: theme.onSurface }}>{title}</Text>
      {subtitle ? <Text style={{ marginTop: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline }}>{subtitle}</Text> : null}
    </View>
  )
}

export function MiniAction({
  label,
  icon: Icon,
  onPress,
  tone,
}: {
  label: string
  icon: any
  onPress: () => void
  tone: 'good' | 'danger' | 'neutral'
}) {
  const theme = useAppTheme()
  const color = tone === 'danger' ? theme.dangerText : tone === 'good' ? theme.primary : theme.outline
  const bg = tone === 'danger' ? theme.dangerBg : tone === 'good' ? theme.secondaryContainer : theme.surfaceContainerLow
  return (
    <TouchableOpacity onPress={onPress} style={{ minHeight: 40, borderRadius: RADIUS.md, backgroundColor: bg, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon size={14} color={color} />
      <Text style={ctaTextStyle(color, 11)}>{label}</Text>
    </TouchableOpacity>
  )
}

export function SheetAction({ label, onPress, loading }: { label: string; onPress: () => void; loading?: boolean }) {
  const theme = useAppTheme()
  return (
    <TouchableOpacity onPress={onPress} disabled={loading} style={{ height: 46, borderRadius: RADIUS.md, backgroundColor: theme.surface, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, alignItems: 'center', justifyContent: 'center' }}>
      {loading ? <ActivityIndicator color={theme.primary} /> : <Text style={ctaTextStyle(theme.primary, 13)}>{label}</Text>}
    </TouchableOpacity>
  )
}
