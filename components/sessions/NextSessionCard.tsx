import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Users, ChevronRight } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { getSessionSkillLabel } from '@/lib/sessionDetail'
import { STRINGS } from '@/constants/strings'

interface NextSessionCardProps {
  session: any
  onPress: (id: string) => void
  isHost?: boolean
}

export function NextSessionCard({ session, onPress, isHost = false }: NextSessionCardProps) {
  const theme = useAppTheme()
  const { t } = useTranslation()

  // Data normalization
  const startTime = session.start_time || session.slot?.start_time
  const endTime = session.end_time || session.slot?.end_time
  const courtName = session.court_name || session.slot?.court?.name || t('session_card.default_court_title')
  const address = session.court_address || session.slot?.court?.address || t('session_card.no_address')
  const ownerSessions = session.owner_sessions
  const ownerDetails = Array.isArray(ownerSessions) ? (ownerSessions[0] || {}) : (ownerSessions || {})
  const formatType = ownerDetails.format_type || session.format_type || 'social'
  const fmt = formatType.toLowerCase()
  const title = session.title || (fmt === 'round_robin' ? 'Round Robin' : (fmt === 'open_play' ? 'Open Play' : t('session_card.format_social')))
  
  const confirmedCount = isHost 
    ? (session.session_players?.filter((p: any) => p.status === 'confirmed' || p.status === 'checked_in').length || 0)
    : (session.player_count || 0)
    
  const maxPlayers = session.is_unlimited ? 16 : (session.max_players || 16)
  const costPerPerson = ownerDetails.format_metadata?.cost_per_person ?? ownerDetails.total_cost ?? session.total_cost
  const priceLabel = costPerPerson > 0 ? `${Math.round(costPerPerson / 1000)}K` : t('session_card.free')
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
  const isWithin24h = startDate.getTime() > now && (startDate.getTime() - now) < (24 * 3600000)
  const isUrgent = isUnderfilled && isWithin24h

  let statusLabel = ''
  let statusBg = theme.primary
  
  if (isHost) {
    if (isPlaying) {
      statusLabel = t('session_card.status_playing_match')
      statusBg = theme.primary
    } else if (isCancelled) {
      statusLabel = t('session_card.status_cancelled')
      statusBg = theme.outline
    } else if (isDone) {
      statusLabel = t('session_card.status_done')
      statusBg = theme.outline
    } else if (isFull) {
      statusLabel = t('session_card.status_full')
      statusBg = theme.warning
    } else if (isUrgent) {
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
    const fmt = (ownerDetails.format_type || session.format_type || '').toLowerCase()
    if (fmt === 'round_robin') statusLabel = 'ROUND ROBIN'
    else if (fmt === 'open_play') statusLabel = 'OPEN PLAY'
    else statusLabel = t('session_card.format_social')
  }

  const formatClock = (date: Date) => {
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const getDayLabel = (date: Date) => {
    const today = new Date()
    const tomorrow = new Date()
    tomorrow.setDate(today.getDate() + 1)
    
    if (date.toDateString() === today.toDateString()) return t('session_card.today')
    if (date.toDateString() === tomorrow.toDateString()) return t('session_card.tomorrow')
    
    const days = t('session_card.days', { returnObjects: true }) as string[]
    return days[date.getDay()]
  }

  const renderSkillBadge = (label: string, type: 'NAM' | 'NỮ') => {
    const isNam = type === 'NAM'
    const bgColor = isNam ? theme.infoContainer : theme.dangerContainer
    const textColor = isNam ? theme.info : theme.danger
    const borderColor = isNam ? theme.info : theme.danger

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
          <Text style={styles.courtBadge}>{t('session_card.court_number', { number: subCourts.join(', ') })}</Text>
        )}
      </View>

      <View style={styles.contentPadding}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.title, { color: theme.onSurface }]}>
          {isHost ? title.toUpperCase() : courtName.toUpperCase()}
        </Text>
        <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.location, { color: theme.onSurfaceVariant }]}>
          {isHost ? courtName : address}
        </Text>
      </View>

      <View style={[styles.infoGrid, { backgroundColor: theme.surfaceAlt }]}>
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
            <Text style={[styles.gridLabel, { color: theme.onSurfaceVariant }]}>{t('session_card.time_label')}</Text>
            <Text style={[styles.clockValue, { color: theme.onSurface }]}>
              {formatClock(startDate)}
            </Text>
            <Text style={[styles.gridSubValue, { color: theme.onSurfaceVariant }]}>
              {t('session_card.time_to', { time: formatClock(endDate) })}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.gridLabel, { color: theme.onSurfaceVariant }]}>{t('session_card.cost_label')}</Text>
            <Text style={[styles.priceValue, { color: theme.onSurface }]}>
              {priceLabel}
            </Text>
            <Text style={[styles.gridSubValue, { color: theme.onSurfaceVariant }]}>
              {priceLabel === t('session_card.free') ? '' : t('session_card.per_person')}
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
            <Text style={[styles.detailButtonText, { color: statusBg }]}>{t('session_card.details_btn')}</Text>
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
