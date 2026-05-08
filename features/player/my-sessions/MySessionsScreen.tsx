import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  Text,
  View,
} from 'react-native'
import {
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
} from 'lucide-react-native'
import { router } from 'expo-router'
import { MainHeader } from '@/components/design'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER } from '@/constants/screenLayout'
import { MySessionCard, type SessionTab } from '@/components/sessions/MySessionCard'
import { MySessionsEmptyState } from '@/components/sessions/MySessionsEmptyState'
import { ExpandingCreateButton } from '@/components/sessions/ExpandingCreateButton'
import { useMySessions, HISTORY_PAGE_SIZE } from './hooks/useMySessions'

import { HistoryFilterModal } from './components/HistoryFilterModal'
import { HistorySection, HistoryRow, MySession } from './types'
import { 
  formatDatePart, 
  formatTimeRange, 
  getMonthKey, 
  formatMonthLabel 
} from './utils'

const TAB_OPTIONS: { key: SessionTab; label: string }[] = [
  { key: 'upcoming', label: 'Sắp đánh' },
  { key: 'pending', label: 'Chờ duyệt' },
  { key: 'history', label: 'Lịch sử' },
]

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
    historyStatusFilter,
    setHistoryStatusFilter,
    historyRoleFilter,
    setHistoryRoleFilter,
    historyTimeFilter,
    setHistoryTimeFilter,
    historyRatingFilter,
    setHistoryRatingFilter,
    historyResultFilter,
    setHistoryResultFilter,
    historyVisibleCount,
    setHistoryVisibleCount,
    historyExpandedMonths,
    setHistoryExpandedMonths,
  } = useMySessions()

  const [historyFilterModalVisible, setHistoryFilterModalVisible] = useState(false)

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

  const historyRows = useMemo<HistoryRow[]>(() => {
    const rows: HistoryRow[] = [{ type: 'filters', key: 'history-filters' }]
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

  const listData = activeTab === 'history' ? historyRows : sessionsByTab[activeTab]
  const canLoadMoreHistory = historyVisibleCount < filteredHistorySessions.length
  const isHistoryTab = activeTab === 'history'
  
  const activeHistoryFiltersCount = useMemo(
    () =>
      [
        historyStatusFilter !== 'all',
        historyRoleFilter !== 'all',
        historyTimeFilter !== 'all',
        historyRatingFilter !== 'all',
        historyResultFilter !== 'all',
      ].filter(Boolean).length,
    [historyRatingFilter, historyResultFilter, historyRoleFilter, historyStatusFilter, historyTimeFilter],
  )

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
            contentContainerStyle={{ paddingHorizontal: SPACING.xl, paddingTop: 0, paddingBottom: 160 }}
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
              <View className="mb-2">
                <MainHeader
                  title="Kèo của tôi"
                  subtitle={activeTab === 'history' ? `${activeTabCount} trận đã lưu` : `${activeTabCount} kèo đang xử lý`}
                  rightElement={<ExpandingCreateButton />}
                  style={{ paddingHorizontal: 0 }}
                />

                <View
                  style={{
                    flexDirection: 'row',
                    gap: 4,
                    padding: 4,
                    backgroundColor: theme.surfaceContainerLow,
                    borderRadius: RADIUS.lg,
                    borderWidth: 1,
                    borderColor: theme.outlineVariant,
                    overflow: 'hidden',
                  }}
                >
                  {TAB_OPTIONS.map((tab) => {
                    const active = tab.key === activeTab
                    return (
                      <Pressable
                        key={tab.key}
                        onPress={() => setActiveTab(tab.key)}
                        className="flex-1 py-2.5 items-center justify-center"
                        style={[
                          { borderRadius: RADIUS.md }, 
                          active && { backgroundColor: theme.primary }
                        ]}
                      >
                        <Text
                          style={{
                            color: active ? theme.onPrimary : theme.onSurfaceVariant,
                            fontFamily: SCREEN_FONTS.cta,
                            fontSize: 13,
                            textTransform: 'uppercase',
                            letterSpacing: 0.8,
                          }}
                        >
                          {tab.label}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
                <View className={isHistoryTab ? 'pt-2' : 'pt-3'} />
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
              if (isHistoryTab && 'type' in item) {
                if (item.type === 'filters') {
                  return (
                    <View
                      className="pt-1 pb-1"
                      style={{ backgroundColor: theme.background, marginHorizontal: -20, paddingHorizontal: SPACING.xl }}
                    >
                      <Pressable
                        onPress={() => setHistoryFilterModalVisible(true)}
                        className="flex-row items-center self-start px-4 py-2.5"
                        style={{
                          borderRadius: RADIUS.md,
                          backgroundColor: activeHistoryFiltersCount > 0 ? theme.primary : theme.surfaceContainerLow,
                          borderWidth: BORDER.base,
                          borderColor: activeHistoryFiltersCount > 0 ? theme.primary : theme.outlineVariant,
                        }}
                      >
                        <SlidersHorizontal
                          size={13}
                          color={activeHistoryFiltersCount > 0 ? theme.onPrimary : theme.onSurfaceVariant}
                          strokeWidth={2.5}
                        />
                        <Text
                          className="ml-1.5"
                          style={{
                            color: activeHistoryFiltersCount > 0 ? theme.onPrimary : theme.onSurfaceVariant,
                            fontFamily: SCREEN_FONTS.cta,
                            fontSize: 12,
                          }}
                        >
                          {activeHistoryFiltersCount > 0 ? `Bộ lọc lịch sử (${activeHistoryFiltersCount})` : 'Bộ lọc lịch sử'}
                        </Text>
                      </Pressable>
                    </View>
                  )
                }

                if (item.type === 'month') {
                  const isExpanded = historyExpandedMonths[item.monthKey]
                  const monthTotal = monthTotalsByKey[item.monthKey] ?? item.count
                  return (
                    <Pressable
                      onPress={() => toggleMonthExpanded(item.monthKey)}
                      className="mt-4 mb-3 flex-row items-center"
                    >
                      <View className="flex-row items-center pr-3">
                        {isExpanded ? (
                          <ChevronDown size={14} color={theme.onSurfaceVariant} strokeWidth={2.4} />
                        ) : (
                          <ChevronRight size={14} color={theme.onSurfaceVariant} strokeWidth={2.4} />
                        )}
                        <Text
                          className="ml-2 text-[11px] uppercase tracking-[2px]"
                          style={{
                            color: theme.outline,
                            fontFamily: SCREEN_FONTS.cta,
                          }}
                        >
                          {item.monthLabel}
                        </Text>
                      </View>
                      <View className="h-px flex-1" style={{ backgroundColor: theme.outlineVariant }} />
                      <Text
                        className="pl-3 text-[11px] uppercase tracking-[2px]"
                        style={{
                          color: theme.outline,
                          fontFamily: SCREEN_FONTS.cta,
                        }}
                      >
                        {monthTotal} trận
                      </Text>
                    </Pressable>
                  )
                }

                if (item.type === 'session') {
                  return (
                    <MySessionCard
                      item={item.session}
                      tab={activeTab}
                      onOpenSessionDetail={(id) => router.push({ pathname: '/session/[id]', params: { id } } as any)}
                      onOpenRateSession={(id) => router.push({ pathname: '/rate-session/[id]', params: { id } } as any)}
                      onShare={handleShare}
                      formatTimeRange={formatTimeRange}
                    />
                  )
                }
              }

              return (
                <MySessionCard
                  item={item as MySession}
                  tab={activeTab}
                  onOpenSessionDetail={(id) => router.push({ pathname: '/session/[id]', params: { id } } as any)}
                  onOpenRateSession={(id) => router.push({ pathname: '/rate-session/[id]', params: { id } } as any)}
                  onShare={handleShare}
                  formatTimeRange={formatTimeRange}
                />
              )
            }}
          />

          <HistoryFilterModal
            visible={historyFilterModalVisible}
            onClose={() => setHistoryFilterModalVisible(false)}
            filters={{
              status: historyStatusFilter,
              role: historyRoleFilter,
              time: historyTimeFilter,
              rating: historyRatingFilter,
              result: historyResultFilter,
            }}
            onFilterChange={(key, value) => {
              if (key === 'status') setHistoryStatusFilter(value)
              if (key === 'role') setHistoryRoleFilter(value)
              if (key === 'time') setHistoryTimeFilter(value)
              if (key === 'rating') setHistoryRatingFilter(value)
              if (key === 'result') setHistoryResultFilter(value)
            }}
          />
        </View>
      )}

    </View>
  )
}
