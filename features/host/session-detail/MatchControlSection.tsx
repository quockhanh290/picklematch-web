import { RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

type Props = {
  title: string
  subtitle?: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

export function MatchControlSection({ title, subtitle, expanded, onToggle, children }: Props) {
  return (
    <View style={{ backgroundColor: '#F9F8F4', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: '#E5E3DC', marginBottom: 16, overflow: 'hidden' }}>
      <TouchableOpacity
        onPress={onToggle}
        style={{ padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 12, color: '#1A2E2A', fontWeight: '900' }}>
            {title}
          </Text>
          {!!subtitle && (
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 2 }}>
              {subtitle}
            </Text>
          )}
        </View>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
          {expanded ? 'Thu gon' : 'Mo'}
        </Text>
      </TouchableOpacity>
      {expanded && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
          {children}
        </View>
      )}
    </View>
  )
}
