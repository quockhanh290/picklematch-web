import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Users, MapPin } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { MySession } from '@/features/player/my-sessions/types'
import { formatDatePart } from '@/features/player/my-sessions/utils'

import { getSessionSkillLabel } from '@/lib/sessionDetail'
import { STRINGS } from '@/constants/strings'

interface UpcomingSessionCardProps {
  session: MySession
  onPress: (id: string) => void
  isHost?: boolean
}

export function UpcomingSessionCard({ session, onPress, isHost = false }: UpcomingSessionCardProps) {
  const theme = useAppTheme()
  const { t } = useTranslation()

  // Dynamic Status Logic matching Host Dashboard
  const confirmedCount = session.player_count || 0
  const maxPlayers = session.max_players || 1
  const fillRatio = confirmedCount / maxPlayers
  const isFull = fillRatio >= 1

  let statusLabel = ''
  let statusBg = theme.primary
  
  if (isHost) {
    if (isFull) {
      statusLabel = t('session_card.status_full')
      statusBg = theme.warning
    } else if (fillRatio < 0.6) {
      statusLabel = t('session_card.status_need_players')
      statusBg = theme.error
    } else {
      statusLabel = t('session_card.status_open')
      statusBg = theme.primary
    }
  } else {
    // Player View: Show format type
    statusBg = theme.primary
    const ownerSessions = session.owner_sessions
    const ownerDetails = Array.isArray(ownerSessions) ? (ownerSessions[0] || {}) : (ownerSessions || {})
    const fmtInternal = (ownerDetails.format_type || session.format_type || '').toLowerCase()
    if (fmtInternal === 'round_robin') statusLabel = 'ROUND ROBIN'
    else if (fmtInternal === 'open_play') statusLabel = 'OPEN PLAY'
    else statusLabel = t('session_card.format_social')
  }

  const ownerSessions = session.owner_sessions
  const ownerDetails = Array.isArray(ownerSessions) ? (ownerSessions[0] || {}) : (ownerSessions || {})
  const fmt = (ownerDetails.format_type || session.format_type || '').toLowerCase()

  // Helper for skill badges
  const renderSkillBadge = (label: string, type: 'NAM' | 'NỮ') => {
    const isNam = type === 'NAM'
    const bgColor = isNam ? theme.infoContainer : theme.dangerContainer
    const textColor = isNam ? theme.info : theme.danger
    const borderColor = isNam ? theme.info : theme.danger

    return (
      <View style={[styles.skillBadge, { backgroundColor: bgColor, borderColor, borderWidth: 1 }]}>
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
          <Text style={styles.courtBadge}>{t('session_card.status_playing')}</Text>
        )}
      </View>

      <View style={styles.contentPadding}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.onSurface }]}>
          {(session.court_name || t('session_card.default_court_name')).toUpperCase()}
        </Text>
        <Text numberOfLines={1} style={[styles.location, { color: theme.onSurfaceVariant }]}>
          {isHost 
            ? (session.title || (fmt === 'round_robin' ? 'Round Robin' : (fmt === 'open_play' ? 'Open Play' : t('session_card.format_social'))))
            : session.court_address}
        </Text>
      </View>

      <View style={[styles.infoGrid, { backgroundColor: theme.surfaceAlt }]}>
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
            <Text style={[styles.gridLabel, { color: theme.onSurfaceVariant }]}>{t('session_card.time_label')}</Text>
            <Text style={[styles.clockValue, { color: theme.onSurface }]}>
              {formatClock(session.start_time)}
            </Text>
            <Text style={[styles.gridSubValue, { color: theme.onSurfaceVariant }]}>
              {t('session_card.time_to', { time: formatClock(session.end_time) })}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.gridLabel, { color: theme.onSurfaceVariant }]}>{t('session_card.cost_label')}</Text>
            <Text style={[styles.priceValue, { color: theme.onSurface }]}>
              {session.total_cost && session.total_cost > 0 
                ? `${Math.round(session.total_cost / 1000)}K` 
                : t('session_card.free')}
            </Text>
            <Text style={[styles.gridSubValue, { color: theme.onSurfaceVariant }]}>
              {session.total_cost && session.total_cost > 0 ? t('session_card.per_person') : ''}
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
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 12,
    letterSpacing: 1,
    fontWeight: '700',
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
    fontSize: 20,
    lineHeight: 24,
    marginBottom: 0,
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
    fontSize: 22,
    lineHeight: 22,
  },
  priceValue: {
    fontFamily: AppFontSet.headline,
    fontSize: 18,
    lineHeight: 18,
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
