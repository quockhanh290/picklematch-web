import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Users, ChevronRight, MapPin } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'

// Mock Data for Test Screen
export type MockSession = {
  id: string
  title: string
  courtName: string
  courtAddress: string
  startTime: string // ISO string
  endTime: string
  confirmedCount: number
  maxPlayers: number
  price: number
  status: 'playing' | 'full' | 'urgent' | 'done' | 'open'
  formatLabel: string
  skillNam: string
  skillNu: string
  footerActionText?: string
}

const getStatusColor = (status: string, theme: any) => {
  switch (status) {
    case 'playing': return theme.primary
    case 'full': return theme.warning
    case 'urgent': return '#D85A30' // Match Coral color
    case 'done': return theme.outline
    case 'open':
    default: return theme.primary
  }
}

const getTopLabel = (status: string, formatLabel: string, isHost: boolean) => {
  if (!isHost) {
    // Player View: Show format label mostly, but override for playing/done if needed
    if (status === 'done') return 'KẾT THÚC'
    if (status === 'playing') return 'THI ĐẤU'
    return formatLabel
  }

  // Host View
  switch (status) {
    case 'playing': return 'THI ĐẤU'
    case 'full': return 'ĐÃ ĐẦY'
    case 'urgent': return 'CẦN THÊM NGƯỜI'
    case 'done': return 'KẾT THÚC'
    case 'open':
    default: return 'ĐANG MỞ'
  }
}

const formatTimeRange = (start: string, end: string) => {
  const d1 = new Date(start)
  const d2 = new Date(end)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d1.getHours())}:${pad(d1.getMinutes())} - ${pad(d2.getHours())}:${pad(d2.getMinutes())}`
}

// Micro-UI: Skill Badge
const SkillBadge = ({ type, label, theme }: { type: 'NAM' | 'NỮ', label: string, theme: any }) => {
  const isNam = type === 'NAM'
  const bgColor = isNam ? theme.successContainer : '#FDF2F0' // Very light coral for Nữ background
  const textColor = isNam ? theme.success : '#D85A30' // Coral orange for Nữ text
  const borderColor = isNam ? theme.success + '40' : '#D85A3040'

  return (
    <View style={{ backgroundColor: bgColor, borderColor, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ color: textColor, fontFamily: SCREEN_FONTS.headline, fontSize: 12 }}>{type}</Text>
      <Text style={{ color: textColor, fontFamily: SCREEN_FONTS.headline, fontSize: 12 }}>{label}</Text>
    </View>
  )
}

// Micro-UI: Progress Bar Footer
const CapacityFooter = ({ count, max, statusColor, theme, actionText }: { count: number, max: number, statusColor: string, theme: any, actionText: string }) => {
  const displayMax = 10
  const segments = []
  const fillRatio = count / max
  
  for (let i = 0; i < displayMax; i++) {
    const isActive = i < fillRatio * displayMax
    segments.push(
      <View 
        key={i} 
        style={{ 
          flex: 1, 
          height: 5, 
          borderRadius: 4, 
          backgroundColor: isActive ? statusColor : theme.outlineVariant,
          opacity: isActive ? 1 : 0.3
        }} 
      />
    )
  }

  return (
    <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.surfaceAlt, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: theme.outlineVariant + '40' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Users size={14} color={statusColor} />
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: statusColor, marginTop: 1 }}>{count}/{max}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 3, width: 100 }}>
          {segments}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: statusColor + '15', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 2 }}>
        <Text style={{ color: statusColor, fontFamily: SCREEN_FONTS.headline, fontSize: 12 }}>{actionText}</Text>
        <ChevronRight size={14} color={statusColor} />
      </View>
    </View>
  )
}

const getActionText = (status: string, isHost: boolean) => {
  if (isHost) return 'QUẢN LÝ'
  if (status === 'done') return 'KẾT QUẢ'
  if (status === 'playing') return 'CHI TIẾT'
  return 'THAM GIA'
}

export const FeaturedSessionCard = ({ session, onPress, isHost = false }: { session: MockSession, onPress?: () => void, isHost?: boolean }) => {
  const theme = useAppTheme()
  const statusColor = getStatusColor(session.status, theme)
  const topLabel = getTopLabel(session.status, session.formatLabel, isHost)
  const actionText = session.footerActionText || getActionText(session.status, isHost)

  const timeStr = new Date(session.startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const endStr = new Date(session.endTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={{ backgroundColor: theme.surface, borderRadius: RADIUS.xl, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, ...SHADOW.md, overflow: 'hidden', marginBottom: SPACING.md }}>
      
      {/* Header Status Bar */}
      <View style={{ backgroundColor: statusColor, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: 'white' }} />
          <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }}>{topLabel}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 }}>
        {/* Title & Address */}
        <View style={{ marginBottom: 8 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 26, color: theme.onSurface, textTransform: 'uppercase' }} numberOfLines={1}>{session.title || 'GIAO LƯU'}</Text>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.onSurfaceVariant, marginTop: 2 }} numberOfLines={1}>{session.courtName}</Text>
        </View>

        {/* Badges Row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View style={{ backgroundColor: theme.primary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.xs }}>
            <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.bold, fontSize: 11 }}>HÔM NAY</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {session.skillNam && <SkillBadge type="NAM" label={session.skillNam} theme={theme} />}
            {session.skillNu && <SkillBadge type="NỮ" label={session.skillNu} theme={theme} />}
          </View>
        </View>

        {/* 2 Columns: Time and Cost */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          {/* Time Column */}
          <View>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>THỜI GIAN</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, color: theme.onSurface, lineHeight: 30 }}>{timeStr}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.onSurfaceVariant, marginTop: 2 }}>đến {endStr}</Text>
          </View>
          
          {/* Cost Column */}
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>CHI PHÍ</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, color: theme.onSurface, lineHeight: 30 }}>{session.price > 0 ? `${session.price}K` : 'Miễn phí'}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.onSurfaceVariant, marginTop: 2 }}>/người</Text>
          </View>
        </View>
      </View>
      
      <CapacityFooter count={session.confirmedCount} max={session.maxPlayers} statusColor={statusColor} theme={theme} actionText={actionText} />
    </TouchableOpacity>
  )
}

export const ListSessionCard = ({ session, onPress, isHost = false }: { session: MockSession, onPress?: () => void, isHost?: boolean }) => {
  const theme = useAppTheme()
  const statusColor = getStatusColor(session.status, theme)
  const topLabel = getTopLabel(session.status, session.formatLabel, isHost)
  const actionText = session.footerActionText || getActionText(session.status, isHost)
  
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={{ backgroundColor: theme.surface, borderRadius: RADIUS.lg, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, ...SHADOW.sm, overflow: 'hidden', marginBottom: SPACING.sm }}>
      <View style={{ backgroundColor: statusColor, paddingHorizontal: 14, paddingVertical: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'white' }} />
          <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase' }}>{topLabel}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface, textTransform: 'uppercase' }} numberOfLines={1}>{session.courtName}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurfaceVariant, marginTop: 2 }} numberOfLines={1}>{session.courtAddress}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>{session.price > 0 ? `${session.price}K` : 'Free'}</Text>
            {session.price > 0 && <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 9, color: theme.onSurfaceVariant, marginTop: -2 }}>/người</Text>}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ backgroundColor: theme.outline, paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.xs }}>
              <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.bold, fontSize: 10 }}>NGÀY MAI</Text>
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>{formatTimeRange(session.startTime, session.endTime)}</Text>
          </View>
          
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {session.skillNam && <SkillBadge type="NAM" label={session.skillNam} theme={theme} />}
            {session.skillNu && <SkillBadge type="NỮ" label={session.skillNu} theme={theme} />}
          </View>
        </View>
      </View>
      
      <CapacityFooter count={session.confirmedCount} max={session.maxPlayers} statusColor={statusColor} theme={theme} actionText={actionText} />
    </TouchableOpacity>
  )
}
