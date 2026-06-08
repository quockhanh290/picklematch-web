import React from 'react'
import { View, ScrollView, Text, SafeAreaView, TouchableOpacity } from 'react-native'
import { FeaturedSessionCard, ListSessionCard, MockSession } from '@/components/sessions/v2/UniversalSessionCards'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { WebContainer } from '@/components/design/WebContainer'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { Users, ChevronRight } from 'lucide-react-native'

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

const UnifiedFeaturedSessionCard = ({ session }: { session: MockSession }) => {
  const theme = useAppTheme()
  let statusColor = theme.primary
  let topLabel = session.formatLabel
  let actionText = 'THAM GIA'

  if (session.status === 'playing') {
    statusColor = theme.primary
    topLabel = 'THI ĐẤU'
    actionText = 'CHI TIẾT'
  } else if (session.status === 'full') {
    statusColor = theme.warning
    topLabel = 'ĐÃ ĐẦY'
    actionText = 'CHI TIẾT'
  } else if (session.status === 'urgent') {
    statusColor = '#D85A30'
    topLabel = 'CẦN 1 NGƯỜI GẤP'
    actionText = 'THAM GIA'
  } else if (session.status === 'done') {
    statusColor = theme.outline
    topLabel = 'KẾT THÚC'
    actionText = 'KẾT QUẢ'
  } else {
    topLabel = 'ĐANG MỞ'
    actionText = 'THAM GIA'
  }
  
  const timeStr = new Date(session.startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const endStr = new Date(session.endTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })

  const displayMax = 10
  const segments = []
  const fillRatio = session.confirmedCount / session.maxPlayers
  
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
    <TouchableOpacity activeOpacity={0.9} style={{ backgroundColor: theme.surface, borderRadius: RADIUS.xl, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, ...SHADOW.md, overflow: 'hidden', marginBottom: SPACING.md }}>
      
      {/* Header Status Bar (Highlight Suggestion/Urgent) */}
      <View style={{ backgroundColor: statusColor, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: 'white' }} />
          <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase' }}>{topLabel}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 }}>
        {/* Title & Address with Distance */}
        <View style={{ marginBottom: 8 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 26, color: theme.onSurface, textTransform: 'uppercase' }} numberOfLines={1}>{session.title || 'GIAO LƯU'}</Text>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.onSurfaceVariant, marginTop: 2 }} numberOfLines={1}>
            {session.courtName} • <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.bold }}>Cách 2.5km</Text>
          </Text>
        </View>

        {/* Badges Row (Suggestion / Day / Skill) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
             <View style={{ backgroundColor: theme.primary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.xs }}>
              <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.bold, fontSize: 11 }}>HÔM NAY</Text>
            </View>
          </View>
         
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {session.skillNam && <SkillBadge type="NAM" label={session.skillNam} theme={theme} />}
            {session.skillNu && <SkillBadge type="NỮ" label={session.skillNu} theme={theme} />}
          </View>
        </View>

        {/* 2 Columns: Time and Cost */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>THỜI GIAN</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, color: theme.onSurface, lineHeight: 30 }}>{timeStr}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.onSurfaceVariant, marginTop: 2 }}>đến {endStr}</Text>
          </View>
          
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>CHI PHÍ</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, color: theme.onSurface, lineHeight: 30 }}>{session.price > 0 ? `${session.price}K` : 'Miễn phí'}</Text>
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 13, color: theme.onSurfaceVariant, marginTop: 2 }}>/người</Text>
          </View>
        </View>
      </View>
      
      {/* Capacity Footer Unified: Avatars + Solid CTA */}
      <View style={{ paddingHorizontal: 14, paddingVertical: 12, backgroundColor: theme.surfaceAlt, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: theme.outlineVariant + '40' }}>
        
        {/* Left Side: Avatars + Progress */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* Overlapping Avatars */}
            {[1, 2, 3].map((_, index) => (
              <View 
                key={index}
                style={{
                  width: 26, 
                  height: 26, 
                  borderRadius: 13, 
                  backgroundColor: avatarColors[index],
                  borderWidth: 2,
                  borderColor: theme.surface,
                  marginLeft: index === 0 ? 0 : -8,
                  zIndex: 3 - index,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Text style={{ fontSize: 10, fontFamily: SCREEN_FONTS.bold, color: avatarTexts[index] }}>{String.fromCharCode(65 + index)}</Text>
              </View>
            ))}
          </View>
          
          <View style={{ flex: 1, paddingRight: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 14, color: statusColor }}>{session.confirmedCount}/{session.maxPlayers} NGƯỜI</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 3 }}>
              {segments}
            </View>
          </View>
        </View>

        {/* Right Side: Solid CTA Button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: statusColor, paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.sm, gap: 2, ...SHADOW.sm }}>
          <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 13 }}>{actionText}</Text>
          <ChevronRight size={14} color="white" />
        </View>

      </View>
    </TouchableOpacity>
  )
}

const UnifiedListSessionCard = ({ session }: { session: MockSession }) => {
  const theme = useAppTheme()
  let statusColor = theme.primary
  let topLabel = session.formatLabel
  let actionText = 'THAM GIA'

  if (session.status === 'playing') {
    statusColor = theme.primary
    topLabel = 'THI ĐẤU'
    actionText = 'CHI TIẾT'
  } else if (session.status === 'full') {
    statusColor = theme.warning
    topLabel = 'ĐÃ ĐẦY'
    actionText = 'CHI TIẾT'
  } else if (session.status === 'urgent') {
    statusColor = '#D85A30'
    topLabel = 'CẦN 1 NGƯỜI GẤP'
    actionText = 'THAM GIA'
  } else if (session.status === 'done') {
    statusColor = theme.outline
    topLabel = 'KẾT THÚC'
    actionText = 'KẾT QUẢ'
  } else {
    topLabel = 'ĐANG MỞ'
    actionText = 'THAM GIA'
  }
  
  const timeStr = new Date(session.startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const endStr = new Date(session.endTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })

  const displayMax = 10
  const segments = []
  const fillRatio = session.confirmedCount / session.maxPlayers
  
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
    <TouchableOpacity activeOpacity={0.9} style={{ backgroundColor: theme.surface, borderRadius: RADIUS.lg, borderWidth: BORDER.hairline, borderColor: theme.outlineVariant, ...SHADOW.sm, overflow: 'hidden', marginBottom: SPACING.sm }}>
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
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurfaceVariant, marginTop: 2 }} numberOfLines={1}>
              {session.courtAddress} • <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.bold }}>Cách 2.5km</Text>
            </Text>
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
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onSurface }}>{timeStr} - {endStr}</Text>
          </View>
          
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {session.skillNam && <SkillBadge type="NAM" label={session.skillNam} theme={theme} />}
            {session.skillNu && <SkillBadge type="NỮ" label={session.skillNu} theme={theme} />}
          </View>
        </View>
      </View>
      
      {/* Mini Capacity Footer for List Card */}
      <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.surfaceAlt, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: theme.outlineVariant + '40' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {[1, 2].map((_, index) => (
              <View 
                key={index}
                style={{
                  width: 20, 
                  height: 20, 
                  borderRadius: 10, 
                  backgroundColor: avatarColors[index],
                  borderWidth: 1.5,
                  borderColor: theme.surface,
                  marginLeft: index === 0 ? 0 : -6,
                  zIndex: 2 - index,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Text style={{ fontSize: 8, fontFamily: SCREEN_FONTS.bold, color: avatarTexts[index] }}>{String.fromCharCode(65 + index)}</Text>
              </View>
            ))}
          </View>
          <View style={{ flex: 1, paddingRight: 10 }}>
             <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: statusColor }}>{session.confirmedCount}/{session.maxPlayers} NGƯỜI</Text>
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

export default function TestCardsScreen() {
  const theme = useAppTheme()

  const mockDate = new Date()
  mockDate.setHours(18, 0, 0, 0)
  const mockEnd = new Date()
  mockEnd.setHours(20, 0, 0, 0)

  const baseSession: MockSession = {
    id: '1',
    title: 'GIAO LƯU SOCIAL',
    courtName: 'SÂN PICKLEBALL AN PHÚ',
    courtAddress: '123 Mai Chí Thọ, Quận 2',
    startTime: mockDate.toISOString(),
    endTime: mockEnd.toISOString(),
    confirmedCount: 15, // Almost full
    maxPlayers: 16,
    price: 50,
    status: 'urgent',
    formatLabel: 'OPEN PLAY',
    skillNam: '2.5 - 3.0',
    skillNu: '2.0 - 2.5'
  }

  const states = [
    { label: 'Trạng thái: ĐANG MỞ (Open)', session: { ...baseSession, status: 'open' as const, confirmedCount: 12 } },
    { label: 'Trạng thái: THI ĐẤU (Playing)', session: { ...baseSession, status: 'playing' as const, confirmedCount: 16 } },
    { label: 'Trạng thái: ĐÃ ĐẦY (Full)', session: { ...baseSession, status: 'full' as const, confirmedCount: 16 } },
    { label: 'Trạng thái: CẦN THÊM NGƯỜI (Urgent)', session: { ...baseSession, status: 'urgent' as const, confirmedCount: 15 } },
    { label: 'Trạng thái: KẾT THÚC (Done)', session: { ...baseSession, status: 'done' as const, confirmedCount: 15 } },
  ]

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        <WebContainer>
          <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, marginBottom: 20, color: theme.onSurface }}>
            UI UNIFICATION TEST
          </Text>

          {/* UNIFIED PREVIEW SECTION */}
          <View style={{ marginBottom: 40, backgroundColor: theme.surfaceContainerLow, padding: 16, borderRadius: RADIUS.lg, borderWidth: BORDER.thick, borderColor: theme.primary }}>
             <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 22, marginBottom: 8, color: theme.primary }}>
              KẾT QUẢ ĐỀ XUẤT HỢP NHẤT
            </Text>
            {/* eslint-disable react/no-unescaped-entities */}
            <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 14, marginBottom: 16, color: theme.onSurfaceVariant }}>
              - Bổ sung Avatar người chơi ở Footer{'\n'}
              - CTA "Tham gia" nổi bật (Solid Button){'\n'}
              - Badge gợi ý ("Cần 1 người gấp"){'\n'}
              - Khoảng cách địa lý ("Cách 2.5km")
            </Text>
            {/* eslint-enable react/no-unescaped-entities */}
            {states.map((s, idx) => (
              <View key={`unified-${idx}`} style={{ marginBottom: 24, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: theme.outlineVariant }}>
                <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 14, marginBottom: 8, color: theme.onSurfaceVariant }}>{s.label}</Text>
                
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.outline, marginBottom: 4 }}>Bản Featured (To):</Text>
                <UnifiedFeaturedSessionCard session={s.session} />
                
                <View style={{ height: 12 }} />
                
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: theme.outline, marginBottom: 4 }}>Bản List (Nhỏ gọn):</Text>
                <UnifiedListSessionCard session={s.session} />
              </View>
            ))}
          </View>

          <View style={{ marginBottom: 40 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 22, marginBottom: 16, color: theme.primary, borderBottomWidth: 1, borderBottomColor: theme.outlineVariant, paddingBottom: 8 }}>
              GÓC NHÌN HOST (Tất cả trạng thái)
            </Text>
            {states.map((s, idx) => (
              <View key={`host-${idx}`} style={{ marginBottom: 24 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 14, marginBottom: 8, color: theme.onSurfaceVariant }}>{s.label}</Text>
                {idx === 0 
                  ? <FeaturedSessionCard session={s.session} isHost={true} />
                  : <ListSessionCard session={s.session} isHost={true} />
                }
              </View>
            ))}
          </View>

          <View style={{ marginBottom: 40 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 22, marginBottom: 16, color: theme.primary, borderBottomWidth: 1, borderBottomColor: theme.outlineVariant, paddingBottom: 8 }}>
              GÓC NHÌN PLAYER
            </Text>
            {states.map((s, idx) => (
              <View key={`player-${idx}`} style={{ marginBottom: 24 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.bold, fontSize: 14, marginBottom: 8, color: theme.onSurfaceVariant }}>{s.label}</Text>
                {idx === 0 
                  ? <FeaturedSessionCard session={{...s.session, formatLabel: 'SẮP TỚI'}} isHost={false} />
                  : <ListSessionCard session={s.session} isHost={false} />
                }
              </View>
            ))}
          </View>

        </WebContainer>
      </ScrollView>
    </SafeAreaView>
  )
}
