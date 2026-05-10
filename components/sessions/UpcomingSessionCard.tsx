import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Users, MapPin } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { MySession } from '@/features/player/my-sessions/types'
import { formatDatePart } from '@/features/player/my-sessions/utils'

import { getSessionSkillLabel } from '@/lib/sessionDetail'

interface UpcomingSessionCardProps {
  session: MySession
  onPress: (id: string) => void
}

export function UpcomingSessionCard({ session, onPress }: UpcomingSessionCardProps) {
  const theme = useAppTheme()

  // Dynamic Status Logic matching Host Dashboard
  const confirmedCount = session.player_count || 0
  const maxPlayers = session.max_players || 1
  const fillRatio = confirmedCount / maxPlayers
  const isFull = fillRatio >= 1
  
  const COLORS = {
    teal: '#0F6E56',
    amber: '#D97706',
    coral: '#D85A30',
  }

  let statusLabel = 'ĐANG MỞ'
  let statusBg = COLORS.teal
  
  if (isFull) {
    statusLabel = 'ĐÃ ĐẦY'
    statusBg = COLORS.amber
  } else if (fillRatio < 0.6) {
    statusLabel = 'CẦN THÊM NGƯỜI'
    statusBg = COLORS.coral
  }

  // Helper for skill badges
  const renderSkillBadge = (label: string, type: 'NAM' | 'NỮ') => {
    const isNam = type === 'NAM'
    const bgColor = isNam ? '#E1F5EE' : '#FAECE7'
    const textColor = isNam ? '#0F6E56' : '#993C1D'
    const borderColor = isNam ? '#0F6E5630' : '#993C1D30'

    return (
      <View style={[styles.skillBadge, { backgroundColor: bgColor, borderColor }]}>
        <Text style={[styles.skillText, { color: textColor }]}>{type}</Text>
        <Text style={[styles.skillText, { color: textColor }]}>
          {label.replace('♂', '').replace('♀', '').replace(/\(Nam\)|\(Nữ\)/g, '').trim()}
        </Text>
      </View>
    )
  }

  const formatClock = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const skillLabel = getSessionSkillLabel(session.elo_min, session.elo_max)

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
        {session.status === 'playing' && (
          <Text style={styles.courtBadge}>ĐANG THI ĐẤU</Text>
        )}
      </View>

      <View style={styles.contentPadding}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.onSurface }]}>
          {(session.title || session.court_name).toUpperCase()}
        </Text>
        <Text numberOfLines={1} style={[styles.location, { color: theme.onSurfaceVariant }]}>
          {session.court_address || 'KÈO PICKLEBALL'}
        </Text>
      </View>

      <View style={[styles.infoGrid, { backgroundColor: theme.surfaceContainerLow }]}>
        <View style={styles.gridHeader}>
          <View style={[styles.dayBadge, { backgroundColor: theme.primary }]}>
            <Text style={styles.dayBadgeText}>{formatDatePart(session.start_time).toUpperCase()}</Text>
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
              {formatClock(session.start_time)}
            </Text>
            <Text style={[styles.gridSubValue, { color: theme.onSurfaceVariant }]}>
              đến {formatClock(session.end_time)}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.gridLabel, { color: theme.onSurfaceVariant }]}>CHI PHÍ</Text>
            <Text style={[styles.priceValue, { color: theme.onSurface }]}>
              {session.total_cost && session.total_cost > 0 
                ? `${Math.round(session.total_cost / 1000)}K` 
                : 'Miễn phí'}
            </Text>
            <Text style={[styles.gridSubValue, { color: theme.onSurfaceVariant }]}>
              {session.total_cost && session.total_cost > 0 ? '/ người' : ''}
            </Text>
          </View>
        </View>

        <View style={styles.progressRow}>
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
  progressRow: {
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
})
