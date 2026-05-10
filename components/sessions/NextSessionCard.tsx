import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Users, ChevronRight } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { getSessionSkillLabel } from '@/lib/sessionDetail'

interface NextSessionCardProps {
  session: any
  onPress: (id: string) => void
  isHost?: boolean
}

export function NextSessionCard({ session, onPress, isHost = false }: NextSessionCardProps) {
  const theme = useAppTheme()

  // Data normalization
  const startTime = session.start_time || session.slot?.start_time
  const endTime = session.end_time || session.slot?.end_time
  const courtName = session.court_name || session.slot?.court?.name || 'KÈO PICKLEBALL'
  const address = session.court_address || session.slot?.court?.address || 'Chưa cập nhật địa chỉ'
  const title = session.title || (session.format_type === 'round_robin' ? 'Giải Round Robin' : 'Kèo giao lưu Social')
  
  const confirmedCount = isHost 
    ? (session.session_players?.filter((p: any) => p.status === 'confirmed' || p.status === 'checked_in').length || 0)
    : (session.player_count || 0)
    
  const maxPlayers = session.is_unlimited ? 16 : (session.max_players || 16)
  const priceLabel = session.total_cost > 0 ? `${Math.round(session.total_cost / 1000)}K` : 'Miễn phí'
  const skillLabel = getSessionSkillLabel(session.elo_min, session.elo_max)

  // Status Logic
  const COLORS = {
    teal: '#0F6E56',
    darkTeal: '#064E3B',
    amber: '#D97706',
    coral: '#D85A30',
    gray: '#6B7280'
  }

  const startDate = new Date(startTime)
  const endDate = new Date(endTime)
  const now = Date.now()
  const isPastEnd = endDate.getTime() <= now
  const isPlaying = session.status === 'playing' && !isPastEnd
  const isCancelled = session.status === 'cancelled'
  const isDone = ['completed', 'finished', 'archived', 'done'].includes(session.status) || (isPastEnd && !isCancelled)
  const fillRatio = confirmedCount / maxPlayers
  const isFull = fillRatio >= 1
  const isUnderfilled = fillRatio < 0.6 && !isDone && !isPlaying && !isCancelled

  let statusLabel = 'ĐANG MỞ'
  let statusBg = COLORS.teal
  
  if (isPlaying) {
    statusLabel = 'THI ĐẤU'
    statusBg = COLORS.darkTeal
  } else if (isCancelled) {
    statusLabel = 'ĐÃ HỦY'
    statusBg = COLORS.gray
  } else if (isDone) {
    statusLabel = 'KẾT THÚC'
    statusBg = COLORS.gray
  } else if (isFull) {
    statusLabel = 'ĐÃ ĐẦY'
    statusBg = COLORS.amber
  } else if (isUnderfilled) {
    statusLabel = 'CẦN THÊM NGƯỜI'
    statusBg = COLORS.coral
  }

  // Overwrite for Players: always show primary/teal theme
  if (!isHost) {
    statusBg = theme.primary
    if (isPlaying) statusLabel = 'ĐANG THI ĐẤU'
    else if (isCancelled) statusLabel = 'ĐÃ HỦY'
    else if (isDone) statusLabel = 'ĐÃ KẾT THÚC'
    else statusLabel = 'KÈO SẮP TỚI'
  }

  const formatClock = (date: Date) => {
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const getDayLabel = (date: Date) => {
    const today = new Date()
    const tomorrow = new Date()
    tomorrow.setDate(today.getDate() + 1)
    
    if (date.toDateString() === today.toDateString()) return 'Hôm nay'
    if (date.toDateString() === tomorrow.toDateString()) return 'Ngày mai'
    
    const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
    return days[date.getDay()]
  }

  const renderSkillBadge = (label: string, type: 'NAM' | 'NỮ') => {
    const isNam = type === 'NAM'
    const bgColor = isNam ? '#E1F5EE' : '#FAECE7'
    const textColor = isNam ? '#0F6E56' : '#993C1D'
    const borderColor = isNam ? '#0F6E5630' : '#993C1D30'

    const skillValue = isNam 
      ? label.split('/')[0] 
      : (label.split('/')[1] || label)

    return (
      <View style={[styles.skillBadge, { backgroundColor: bgColor, borderColor }]}>
        <Text style={[styles.skillText, { color: textColor }]}>{type}</Text>
        <Text style={[styles.skillText, { color: textColor }]}>
          {skillValue.replace('♂', '').replace('♀', '').replace(/\(Nam\)|\(nam\)|\(Nữ\)|\(nữ\)|Trình|trình/g, '').trim()}
        </Text>
      </View>
    )
  }

  // Get sub-courts
  const ownerSessions = session.owner_sessions
  const ownerDetails = Array.isArray(ownerSessions) ? (ownerSessions[0] || {}) : (ownerSessions || {})
  const subCourts = ownerDetails.sub_court_numbers || session.sub_court_numbers || []

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => onPress(session.id)}
      style={[
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: theme.outlineVariant,
        }
      ]}
    >
      {/* Header Status Bar */}
      <View style={[styles.statusBar, { backgroundColor: statusBg }]}>
        <View style={styles.statusInner}>
          <View style={styles.statusDot} />
          <Text style={styles.statusLabel}>{statusLabel}</Text>
        </View>
        {subCourts.length > 0 && (
          <Text style={styles.courtBadge}>SÂN {subCourts.join(', ')}</Text>
        )}
      </View>

      <View style={styles.contentPadding}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.title, { color: theme.onSurface }]}>
          {title.toUpperCase()}
        </Text>
        <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.location, { color: theme.onSurfaceVariant }]}>
          {courtName}
        </Text>
      </View>

      <View style={[styles.infoGrid, { backgroundColor: theme.surfaceContainerLow }]}>
        <View style={styles.gridHeader}>
          <View style={[styles.dayBadge, { backgroundColor: statusBg }]}>
            <Text style={styles.dayBadgeText}>{getDayLabel(startDate).toUpperCase()}</Text>
          </View>
          
          <View style={styles.skillRow}>
            {skillLabel && renderSkillBadge(skillLabel, 'NAM')}
            {skillLabel && skillLabel.includes('/') && renderSkillBadge(skillLabel, 'NỮ')}
          </View>
        </View>

        <View style={styles.gridMain}>
          <View>
            <Text style={[styles.gridLabel, { color: theme.onSurfaceVariant }]}>THỜI GIAN</Text>
            <Text style={[styles.clockValue, { color: theme.onSurface }]}>
              {formatClock(startDate)}
            </Text>
            <Text style={[styles.gridSubValue, { color: theme.onSurfaceVariant }]}>
              đến {formatClock(endDate)}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.gridLabel, { color: theme.onSurfaceVariant }]}>CHI PHÍ</Text>
            <Text style={[styles.priceValue, { color: theme.onSurface }]}>
              {priceLabel}
            </Text>
            <Text style={[styles.gridSubValue, { color: theme.onSurfaceVariant }]}>
              {priceLabel === 'Miễn phí' ? '' : '/ người'}
            </Text>
          </View>
        </View>

        <View style={styles.footerRow}>
          <View style={styles.progressMeta}>
            <Users size={14} color={theme.onSurfaceVariant} />
            <Text style={[styles.progressText, { color: theme.onSurfaceVariant }]}>
              {confirmedCount}/{maxPlayers}
            </Text>
            <View style={styles.progressBar}>
              {Array.from({ length: 10 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.progressSegment,
                    {
                      backgroundColor: i < (confirmedCount / maxPlayers) * 10 ? statusBg : theme.outlineVariant,
                      opacity: i < (confirmedCount / maxPlayers) * 10 ? 1 : 0.4,
                    }
                  ]}
                />
              ))}
            </View>
          </View>

          <TouchableOpacity
            onPress={() => onPress(session.id)}
            style={[styles.detailButton, { backgroundColor: statusBg + '10' }]}
          >
            <Text style={[styles.detailButtonText, { color: statusBg }]}>CHI TIẾT</Text>
            <ChevronRight size={14} color={statusBg} />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: BORDER.hairline,
    overflow: 'hidden',
    ...SHADOW.sm,
  },
  statusBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'white',
  },
  statusLabel: {
    color: 'white',
    fontFamily: SCREEN_FONTS.cta,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  courtBadge: {
    color: 'white',
    fontFamily: SCREEN_FONTS.bold,
    fontSize: 9.5,
    letterSpacing: 0.5,
    opacity: 0.95,
  },
  contentPadding: {
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  title: {
    fontFamily: AppFontSet.headline,
    fontSize: 24,
    lineHeight: 28,
    marginBottom: 2,
  },
  location: {
    fontFamily: SCREEN_FONTS.body,
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  infoGrid: {
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  gridHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dayBadge: {
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  dayBadgeText: {
    color: 'white',
    fontFamily: SCREEN_FONTS.cta,
    fontSize: 12,
    lineHeight: 16,
  },
  skillRow: {
    flexDirection: 'row',
    gap: 6,
  },
  skillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  skillText: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 11,
  },
  gridMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  gridLabel: {
    fontFamily: SCREEN_FONTS.label,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  clockValue: {
    fontFamily: AppFontSet.headline,
    fontSize: 26,
    lineHeight: 26,
  },
  priceValue: {
    fontFamily: AppFontSet.headline,
    fontSize: 20,
    lineHeight: 20,
  },
  gridSubValue: {
    fontFamily: SCREEN_FONTS.body,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressText: {
    fontFamily: SCREEN_FONTS.medium,
    fontSize: 12,
  },
  progressBar: {
    flexDirection: 'row',
    gap: 3,
    height: 5,
    width: 100,
  },
  progressSegment: {
    flex: 1,
    borderRadius: 4,
  },
  detailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  detailButtonText: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 11,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
})
