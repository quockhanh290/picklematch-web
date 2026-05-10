import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import {
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  RotateCcw,
} from 'lucide-react-native'
import { router } from 'expo-router'
import { MainHeader } from '@/components/design'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER } from '@/constants/screenLayout'
import { MySessionCard, type SessionTab } from '@/components/sessions/MySessionCard'
import { NextSessionCard } from '@/components/sessions/NextSessionCard'
import { MySessionsEmptyState } from '@/components/sessions/MySessionsEmptyState'
import { ExpandingCreateButton } from '@/components/sessions/ExpandingCreateButton'
import { useMySessions, HISTORY_PAGE_SIZE } from './hooks/useMySessions'

import { HistorySection, SessionRow, MySession } from './types'
import { 
  formatDatePart, 
  formatTimeRange, 
  getMonthKey, 
  formatMonthLabel 
} from './utils'

const TAB_OPTIONS: { key: SessionTab; label: string }[] = [
  { key: 'upcoming', label: 'Sắp đánh' },
  { key: 'history', label: 'Lịch sử' },
]

import { WebContainer } from '@/components/design/WebContainer'

export function MySessionsScreen() {
  const theme = useAppTheme()
  const {
    loading,
    refreshing,
    onRefresh,
    activeTab,
    setActiveTab,
    sessionsByTab,
    filteredHistorySessions,
    historyVisibleCount,
    setHistoryVisibleCount,
    historyExpandedMonths,
    setHistoryExpandedMonths,
  } = useMySessions()



  const visibleHistorySessions = useMemo(
    () => filteredHistorySessions.slice(0, historyVisibleCount),
    [filteredHistorySessions, historyVisibleCount],
  )

  const historySections = useMemo<HistorySection[]>(() => {
    const map = new Map<string, HistorySection>()
    for (const session of visibleHistorySessions) {
      const monthKey = getMonthKey(session.start_time)
      const existing = map.get(monthKey)
      if (existing) {
        existing.items.push(session)
      } else {
        map.set(monthKey, {
          monthKey,
          monthLabel: formatMonthLabel(monthKey),
          items: [session],
        })
      }
    }
    return Array.from(map.values())
  }, [visibleHistorySessions])

  const historyRows = useMemo<SessionRow[]>(() => {
    const rows: SessionRow[] = []
    historySections.forEach((section) => {
      rows.push({
        type: 'month',
        key: `month-${section.monthKey}`,
        monthKey: section.monthKey,
        monthLabel: section.monthLabel,
        count: section.items.length,
      })

      if (historyExpandedMonths[section.monthKey]) {
        section.items.forEach((session) => {
          rows.push({
            type: 'session',
            key: `session-${section.monthKey}-${session.id}`,
            session,
          })
        })
      }
    })
    return rows
  }, [historyExpandedMonths, historySections])

  const upcomingRows = useMemo<SessionRow[]>(() => {
    const upcoming = sessionsByTab.upcoming
    if (upcoming.length === 0) return []

    const rows: SessionRow[] = []
    
    // Sort chronologically
    const sorted = [...upcoming].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    
    // Next session (highlighted)
    const nextSession = sorted[0]
    rows.push({ type: 'next-session', key: 'next-session', session: nextSession })

    const others = sorted.slice(1)
    if (others.length === 0) return rows

    // Grouping logic
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const tomorrow = today + 86400000
    const dayAfterTomorrow = tomorrow + 86400000

    const todaySessions: MySession[] = []
    const tomorrowSessions: MySession[] = []
    const laterSessions: MySession[] = []

    others.forEach(s => {
      const sDate = new Date(s.start_time)
      const sTime = new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate()).getTime()
      
      if (sTime === today) todaySessions.push(s)
      else if (sTime === tomorrow) tomorrowSessions.push(s)
      else laterSessions.push(s)
    })

    const addSection = (label: string, data: MySession[]) => {
      if (data.length === 0) return
      rows.push({ type: 'section-header', key: `header-${label}`, label, count: data.length })
      data.forEach(s => {
        rows.push({ type: 'session', key: `upcoming-${s.id}`, session: s })
      })
    }

    addSection('Hôm nay', todaySessions)
    addSection('Ngày mai', tomorrowSessions)
    addSection('Sắp tới', laterSessions)

    return rows
  }, [sessionsByTab.upcoming])

  const listData = activeTab === 'history' ? historyRows : upcomingRows
  const canLoadMoreHistory = historyVisibleCount < filteredHistorySessions.length
  const isHistoryTab = activeTab === 'history'
  

  const monthTotalsByKey = useMemo(() => {
    const totals: Record<string, number> = {}
    filteredHistorySessions.forEach((session) => {
      const monthKey = getMonthKey(session.start_time)
      totals[monthKey] = (totals[monthKey] ?? 0) + 1
    })
    return totals
  }, [filteredHistorySessions])

  const loadMoreHistory = useCallback(() => {
    if (!isHistoryTab || !canLoadMoreHistory) return
    setHistoryVisibleCount((prev) => Math.min(prev + HISTORY_PAGE_SIZE, filteredHistorySessions.length))
  }, [canLoadMoreHistory, filteredHistorySessions.length, isHistoryTab, setHistoryVisibleCount])

  const toggleMonthExpanded = useCallback((monthKey: string) => {
    setHistoryExpandedMonths((prev) => ({
      ...prev,
      [monthKey]: !prev[monthKey],
    }))
  }, [setHistoryExpandedMonths])

  async function handleShare(session?: MySession) {
    const message = session 
      ? [
          'Cùng xem kèo pickleball này nhé:',
          session.court_name,
          `${formatDatePart(session.start_time)} · ${formatTimeRange(session.start_time, session.end_time)}`,
          session.court_address ? `${session.court_address}${session.court_city ? `, ${session.court_city}` : ''}` : '',
        ].filter(Boolean).join('\n')
      : 'Lịch chơi PickleMatch của tôi đang được cập nhật.'

    try {
      await Share.share({ message })
    } catch (error) {
      console.warn('[MySessions] share failed:', error)
    }
  }

  const activeTabCount = isHistoryTab ? filteredHistorySessions.length : (sessionsByTab[activeTab]?.length ?? 0)

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <WebContainer style={{ flex: 1 }}>
      {loading ? (
        <View className="flex-1 items-center justify-center px-6">
          <ActivityIndicator size="large" color={theme.primary} />
          <Text
            className="mt-4 text-[14px]"
            style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label }}
          >
            Đang tải kèo của bạn...
          </Text>
        </View>
      ) : (
        <View className="flex-1">
          <FlatList
            data={listData}
            keyExtractor={(item) => ('type' in item ? `${activeTab}-${item.key}` : `${activeTab}-${item.id}`)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 0, paddingBottom: 160 }}
            refreshControl={
              <RefreshControl 
                refreshing={refreshing} 
                onRefresh={onRefresh} 
                tintColor={theme.primary} 
                colors={[theme.primary]}
                title="Cập nhật lịch thi đấu..."
                titleColor={theme.onSurfaceVariant}
                progressViewOffset={SPACING.xl}
              />
            }
            alwaysBounceVertical={true}
            stickyHeaderIndices={isHistoryTab ? [1] : undefined}
            onEndReached={loadMoreHistory}
            onEndReachedThreshold={0.25}
            ListHeaderComponent={
              <View style={{ marginBottom: 16 }}>
                <View style={{ 
                  flexDirection: 'row', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginTop: 24,
                  marginBottom: 20
                }}>
                  <View>
                    <Text style={{ 
                      fontFamily: SCREEN_FONTS.headlineBlack, 
                      fontSize: 28, 
                      color: theme.onSurface,
                      letterSpacing: -0.5
                    }}>
                      Kèo của tôi
                    </Text>
                    <Text style={{ 
                      fontFamily: SCREEN_FONTS.body, 
                      fontSize: 13, 
                      color: theme.onSurfaceVariant,
                      marginTop: 2
                    }}>
                      {activeTab === 'history' ? `${activeTabCount} trận đã thi đấu` : `${activeTabCount} kèo sắp tới`}
                    </Text>
                  </View>
                </View>

                {/* Pill Tab Selector */}
                <View style={{ 
                  flexDirection: 'row', 
                  backgroundColor: theme.surfaceContainerHighest, 
                  borderRadius: RADIUS.lg, 
                  padding: 4,
                  gap: 4,
                  marginBottom: 24
                }}>
                  {TAB_OPTIONS.map((tab) => {
                    const active = tab.key === activeTab
                    return (
                      <TouchableOpacity
                        key={tab.key}
                        onPress={() => setActiveTab(tab.key)}
                        style={{
                          flex: 1,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          paddingVertical: 10,
                          borderRadius: RADIUS.md,
                          backgroundColor: active ? theme.surface : 'transparent',
                          ...(active ? {
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.1,
                            shadowRadius: 2,
                            elevation: 1,
                          } : {})
                        }}
                      >
                        <Text style={{
                          fontFamily: SCREEN_FONTS.headlineBlack,
                          fontSize: 13,
                          color: active ? theme.primary : theme.onSurfaceVariant,
                          letterSpacing: 0.5
                        }}>
                          {tab.label.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>
            }
            ListFooterComponent={
              isHistoryTab && canLoadMoreHistory ? (
                <View className="py-6 items-center">
                  <ActivityIndicator size="small" color={theme.primary} />
                </View>
              ) : null
            }
            ListEmptyComponent={<MySessionsEmptyState activeTab={activeTab} />}
            renderItem={({ item }) => {
              if (item.type === 'section-header') {
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 12, gap: 10 }}>
                    <Text style={{ 
                      fontFamily: SCREEN_FONTS.headline, 
                      fontSize: 14, 
                      color: theme.onSurfaceVariant, 
                      letterSpacing: 1,
                      textTransform: 'uppercase'
                    }}>
                      {item.label}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.outlineVariant, opacity: 0.5 }} />
                  </View>
                )
              }

              if (item.type === 'next-session') {
                return (
                  <View style={{ marginBottom: 32 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 }}>
                      <Text style={{ 
                        fontFamily: SCREEN_FONTS.headline, 
                        fontSize: 14, 
                        color: theme.primary, 
                        letterSpacing: 1,
                        textTransform: 'uppercase'
                      }}>
                        Kèo tiếp theo
                      </Text>
                      <View style={{ flex: 1, height: 1, backgroundColor: theme.primary, opacity: 0.2 }} />
                    </View>
                    <NextSessionCard 
                      session={item.session}
                      onPress={(id) => router.push({ pathname: '/session/[id]', params: { id } } as any)}
                    />
                  </View>
                )
              }

              if (item.type === 'month') {
                const isExpanded = historyExpandedMonths[item.monthKey]
                const monthTotal = monthTotalsByKey[item.monthKey] ?? item.count
                return (
                  <Pressable
                    onPress={() => toggleMonthExpanded(item.monthKey)}
                    style={{ 
                      marginTop: 24, 
                      marginBottom: 12, 
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text
                        style={{
                          color: theme.onSurfaceVariant,
                          fontFamily: SCREEN_FONTS.headline,
                          fontSize: 14,
                          letterSpacing: 1,
                          textTransform: 'uppercase'
                        }}
                      >
                        {item.monthLabel}
                      </Text>
                      
                      <View style={{ flex: 1, height: 1, backgroundColor: theme.outlineVariant, opacity: 0.5 }} />
                      
                      <View className="flex-row items-center gap-2">
                        <Text style={{ 
                          color: theme.outline, 
                          fontFamily: SCREEN_FONTS.label, 
                          fontSize: 11,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5
                        }}>
                          {monthTotal} TRẬN
                        </Text>
                        {isExpanded ? (
                          <ChevronDown size={14} color={theme.outline} strokeWidth={2} />
                        ) : (
                          <ChevronRight size={14} color={theme.outline} strokeWidth={2} />
                        )}
                      </View>
                    </View>
                  </Pressable>
                )
              }

              return (
                <MySessionCard 
                  item={item.session}
                  tab={activeTab}
                  onShare={handleShare}
                />
              )
            }}
          />

        </View>
      )}
      </WebContainer>
      <ExpandingCreateButton />
    </View>
  )
}
