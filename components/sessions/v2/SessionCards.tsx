import React from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { Users, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { parseSessionForCard, SessionDisplayData } from '@/lib/session/cardParser'

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
    if (status === 'done') return 'KẾT THÚC'
    if (status === 'playing') return 'THI ĐẤU'
    return formatLabel
  }

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
  const bgColor = isNam ? theme.successContainer : '#FDF2F0' 
  const textColor = isNam ? theme.success : '#D85A30' 
  const borderColor = isNam ? theme.success + '40' : '#D85A3040'

  return (
    <View style={{ backgroundColor: bgColor, borderColor, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ color: textColor, fontFamily: SCREEN_FONTS.headline, fontSize: 12 }}>{type}</Text>
      <Text style={{ color: textColor, fontFamily: SCREEN_FONTS.headline, fontSize: 12 }}>{label}</Text>
    </View>
  )
}

const getActionText = (status: string, isHost: boolean) => {
  if (isHost) return 'QUẢN LÝ'
  if (status === 'done') return 'KẾT QUẢ'
  if (status === 'playing') return 'CHI TIẾT'
  if (status === 'full') return 'CHI TIẾT'
  return 'THAM GIA'
}

const getDayBadge = (dateStr: string) => {
  const date = new Date(dateStr)
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(today.getDate() + 1)
  
  if (date.toDateString() === today.toDateString()) return 'HÔM NAY'
  if (date.toDateString() === tomorrow.toDateString()) return 'NGÀY MAI'
  
  const days = ['CHỦ NHẬT', 'THỨ 2', 'THỨ 3', 'THỨ 4', 'THỨ 5', 'THỨ 6', 'THỨ 7']
  return days[date.getDay()]
}

export interface SessionCardProps {
  session: any
  onPress?: (id: string) => void
  isHost?: boolean
  showDistance?: boolean // Option to turn distance off if needed
  expandableContent?: React.ReactNode
  isExpanded?: boolean
  onToggleExpand?: () => void
  forcePrimaryColor?: boolean
}

export const FeaturedSessionCard = ({ session, onPress, isHost = false, showDistance = true, expandableContent, isExpanded, onToggleExpand, forcePrimaryColor = false }: SessionCardProps) => {
  const theme = useAppTheme()
  const data: SessionDisplayData = parseSessionForCard(session, isHost)
  
  const statusColor = forcePrimaryColor ? theme.primary : getStatusColor(data.status, theme)
  const topLabel = getTopLabel(data.status, data.formatLabel, isHost)
  const actionText = getActionText(data.status, isHost)
  const dayBadge = getDayBadge(data.startTime)

  const timeStr = new Date(data.startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const endStr = new Date(data.endTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })

  const displayMax = 10
  const segments = []
  const fillRatio = data.maxPlayers > 0 ? data.confirmedCount / data.maxPlayers : 0
  
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

  // Mock Avatar colors
  const avatarColors = ['#E1F5EE', '#FAECE7', '#E5E7EB']
  const avatarTexts = ['#0F6E56', '#993C1D', '#374151']

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={() => {
      if (onToggleExpand) onToggleExpand()
      else if (onPress) onPress(data.id)
    }} style={{ backgroundColor: theme.surface, borderRadius: RADIUS.xl, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, ...SHADOW.md, overflow: 'hidden', marginBottom: SPACING.md }}>
      
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
          <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 26, color: theme.onSurface, textTransform: 'uppercase' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{data.title}</Text>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.onSurfaceVariant, marginTop: 2 }} numberOfLines={1}>
            {data.courtName} 
            {showDistance && <Text> • <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.bold }}>Cách 2.5km</Text></Text>}
          </Text>
        </View>

        {/* Badges Row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View style={{ backgroundColor: theme.primary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.xs }}>
            <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.bold, fontSize: 11 }}>{dayBadge}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {data.skillNam ? <SkillBadge type="NAM" label={data.skillNam} theme={theme} /> : null}
            {data.skillNu ? <SkillBadge type="NỮ" label={data.skillNu} theme={theme} /> : null}
          </View>
        </View>

        {/* 2 Columns: Time and Cost */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          {/* Time Column */}
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>THỜI GIAN</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, color: theme.onSurface, lineHeight: 30 }} adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.8}>{timeStr}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.onSurfaceVariant, marginTop: 2 }}>đến {endStr}</Text>
          </View>
          
          {/* Cost Column */}
          <View style={{ alignItems: 'flex-end', flex: 1, paddingLeft: 8 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>CHI PHÍ</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, color: theme.onSurface, lineHeight: 30 }} adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.8}>{data.price > 0 ? `${data.price}K` : 'Miễn phí'}</Text>
            {data.price > 0 && <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.onSurfaceVariant, marginTop: 2 }}>/người</Text>}
          </View>
        </View>
      </View>
      
      {/* Capacity Footer Unified: Avatars + Solid CTA */}
      <View style={{ paddingHorizontal: 14, paddingVertical: 12, backgroundColor: theme.surfaceAlt, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: theme.outlineVariant + '40' }}>
        
        {/* Left Side: Avatars + Progress */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* Overlapping Avatars */}
            {data.avatars.map((avatar, index) => (
              <View 
                key={avatar.id}
                style={{
                  width: 26, 
                  height: 26, 
                  borderRadius: 13, 
                  backgroundColor: avatarColors[avatar.colorIdx],
                  borderWidth: 2,
                  borderColor: theme.surface,
                  marginLeft: index === 0 ? 0 : -8,
                  zIndex: 3 - index,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Text style={{ fontSize: 10, fontFamily: SCREEN_FONTS.bold, color: avatarTexts[avatar.colorIdx] }}>{avatar.initials}</Text>
              </View>
            ))}
          </View>
          
          <View style={{ flex: 1, paddingRight: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: statusColor }}>{data.confirmedCount}/{data.maxPlayers} NGƯỜI</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 3 }}>
              {segments}
            </View>
          </View>
        </View>

        {/* Right Side: Solid CTA Button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: statusColor, paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.sm, gap: 2, ...SHADOW.sm }}>
          <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 13 }}>
            {isExpanded !== undefined ? (isExpanded ? 'THU GỌN' : 'CHI TIẾT') : actionText}
          </Text>
          {isExpanded !== undefined ? (
            isExpanded ? <ChevronUp size={14} color="white" /> : <ChevronDown size={14} color="white" />
          ) : (
            <ChevronRight size={14} color="white" />
          )}
        </View>

      </View>
      
      {expandableContent && isExpanded && (
        <View style={{ backgroundColor: theme.surfaceAlt, paddingBottom: 8 }}>
          {expandableContent}
        </View>
      )}
    </TouchableOpacity>
  )
}

export const ListSessionCard = ({ session, onPress, isHost = false, showDistance = true, forcePrimaryColor = false }: SessionCardProps) => {
  const theme = useAppTheme()
  const data: SessionDisplayData = parseSessionForCard(session, isHost)
  
  const statusColor = forcePrimaryColor ? theme.primary : getStatusColor(data.status, theme)
  const topLabel = getTopLabel(data.status, data.formatLabel, isHost)
  const actionText = getActionText(data.status, isHost)
  const dayBadge = getDayBadge(data.startTime)
  
  const displayMax = 10
  const segments = []
  const fillRatio = data.maxPlayers > 0 ? data.confirmedCount / data.maxPlayers : 0
  
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

  const avatarColors = ['#E1F5EE', '#FAECE7', '#E5E7EB']
  const avatarTexts = ['#0F6E56', '#993C1D', '#374151']

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={() => onPress && onPress(data.id)} style={{ backgroundColor: theme.surface, borderRadius: RADIUS.lg, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, ...SHADOW.sm, overflow: 'hidden', marginBottom: SPACING.sm }}>
      <View style={{ backgroundColor: statusColor, paddingHorizontal: 14, paddingVertical: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'white' }} />
          <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase' }}>{topLabel}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface, textTransform: 'uppercase' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{data.courtName}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurfaceVariant, marginTop: 2 }} numberOfLines={1}>
              {data.courtAddress || data.title}
              {showDistance && <Text> • <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.bold }}>Cách 2.5km</Text></Text>}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', flexShrink: 0, paddingLeft: 8 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }} adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.8}>{data.price > 0 ? `${data.price}K` : 'Miễn phí'}</Text>
            {data.price > 0 && <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 9, color: theme.onSurfaceVariant, marginTop: -2 }}>/người</Text>}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <View style={{ backgroundColor: theme.outline, paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.xs }}>
              <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.bold, fontSize: 10 }}>{dayBadge}</Text>
            </View>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }} adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.8}>{formatTimeRange(data.startTime, data.endTime)}</Text>
          </View>
          
          <View style={{ flexDirection: 'row', gap: 6, flexShrink: 0, paddingLeft: 8 }}>
            {data.skillNam ? <SkillBadge type="NAM" label={data.skillNam} theme={theme} /> : null}
            {data.skillNu ? <SkillBadge type="NỮ" label={data.skillNu} theme={theme} /> : null}
          </View>
        </View>
      </View>
      
      {/* Mini Capacity Footer for List Card */}
      <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.surfaceAlt, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: theme.outlineVariant + '40' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {data.avatars.slice(0, 2).map((avatar, index) => (
              <View 
                key={avatar.id}
                style={{
                  width: 20, 
                  height: 20, 
                  borderRadius: 10, 
                  backgroundColor: avatarColors[avatar.colorIdx],
                  borderWidth: 1.5,
                  borderColor: theme.surface,
                  marginLeft: index === 0 ? 0 : -6,
                  zIndex: 2 - index,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Text style={{ fontSize: 8, fontFamily: SCREEN_FONTS.bold, color: avatarTexts[avatar.colorIdx] }}>{avatar.initials}</Text>
              </View>
            ))}
          </View>
          <View style={{ flex: 1, paddingRight: 10 }}>
             <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: statusColor }}>{data.confirmedCount}/{data.maxPlayers} NGƯỜI</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 2 }}>
              {segments}
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: statusColor, paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.sm, gap: 2, ...SHADOW.sm }}>
          <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>{actionText}</Text>
          <ChevronRight size={12} color="white" />
        </View>
      </View>
    </TouchableOpacity>
  )
}
