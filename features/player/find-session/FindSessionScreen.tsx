import React, { useMemo } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native'
import {
  Navigation,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react-native'
import { 
  AppDialog, 
  MainHeader 
} from '@/components/design'
import { AdvancedSessionFilterModal, ADVANCED_FILTER_INITIAL } from '@/components/find-session/AdvancedSessionFilterModal'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { useAppTheme } from '@/lib/theme-context'
import { ALL_DISTRICTS, SKILL_LEVELS } from '@/constants/systemData'

import { useFindSessionController } from './hooks/useFindSessionController'
import { SearchResultCard } from './components/SearchResultCard'
import { SmartQueueBanner } from './components/SmartQueueBanner'
import { withAlpha } from './utils'

export function FindSessionScreen() {
  const theme = useAppTheme()
  const {
    loading,
    isFirstLoad,
    dialogConfig,
    setDialogConfig,
    refreshing,
    onRefresh,
    userLocation,
    query,
    setQuery,
    sortMode,
    setSortMode,
    preferredCourtFilter,
    clearCourtFilter,
    _setPreferredCourtFilter,
    filterModalVisible,
    setFilterModalVisible,
    advancedFilter,
    setAdvancedFilter,
    activeAdvancedFiltersCount,
    playerProfile,
    smartQueueEnabled,
    smartQueueHydrated,
    applySmartQueueFilters,
    handleNearbyFilter,
    filteredSessions,
  } = useFindSessionController()

  const listHeader = useMemo(() => (
    <View>
      <MainHeader
        title={STRINGS.find_session.title}
        subtitle={loading && isFirstLoad ? STRINGS.common.loading : STRINGS.find_session.status.matches_found.replace('{count}', filteredSessions.length.toString())}
        rightElement={
          <Pressable
            onPress={() => void handleNearbyFilter()}
            className="h-14 w-14 items-center justify-center rounded-full"
            style={{
              backgroundColor: theme.surfaceContainerLow,
              borderWidth: 1,
              borderColor: theme.outlineVariant,
            }}
          >
            <Navigation size={24} color={theme.primary} strokeWidth={2.4} />
          </Pressable>
        }
      />

      <SearchBar 
        query={query}
        setQuery={setQuery}
        activeAdvancedFiltersCount={activeAdvancedFiltersCount}
        onFilterPress={() => setFilterModalVisible(true)}
        theme={theme}
      />

      {/* Sắp xếp - Full Width Tab Strip */}
      <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: 16 }}>
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
          <Pressable
            onPress={() => setSortMode('match')}
            className="flex-1 items-center justify-center py-2.5"
            style={{
              backgroundColor: sortMode === 'match' ? theme.primary : 'transparent',
              borderRadius: RADIUS.md,
            }}
          >
            <Text
              style={{
                color: sortMode === 'match' ? theme.onPrimary : theme.onSurfaceVariant,
                fontFamily: SCREEN_FONTS.cta,
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
              }}
            >
              {STRINGS.find_session.sort.relevance}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSortMode('time')}
            className="flex-1 items-center justify-center py-2.5"
            style={{
              backgroundColor: sortMode === 'time' ? theme.primary : 'transparent',
              borderRadius: RADIUS.md,
            }}
          >
            <Text
              style={{
                color: sortMode === 'time' ? theme.onPrimary : theme.onSurfaceVariant,
                fontFamily: SCREEN_FONTS.cta,
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
              }}
            >
              {STRINGS.find_session.sort.time}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Preferred court filter banner */}
      {preferredCourtFilter ? (
        <View
          className="mx-5 mb-4 flex-row items-center px-4 py-3"
          style={{
            backgroundColor: theme.secondaryContainer,
            borderRadius: RADIUS.xl,
          }}
        >
          <View className="flex-1 pr-3">
            <Text
              style={{ color: theme.onSecondaryContainer, fontFamily: SCREEN_FONTS.headline, fontSize: 10, letterSpacing: 2.2, textTransform: 'uppercase' }}
            >
              {STRINGS.find_session.filtering.nearby}
            </Text>
            <Text
              numberOfLines={1}
              className="mt-1"
              style={{ color: theme.onSecondaryContainer, fontFamily: SCREEN_FONTS.label, fontSize: 13 }}
            >
              {preferredCourtFilter.name ?? STRINGS.find_session.filtering.selected_court}
            </Text>
          </View>
          <Pressable
            onPress={clearCourtFilter}
            className="flex-row items-center rounded-full px-3 py-2"
            style={{ backgroundColor: withAlpha(theme.onSecondaryContainer, 0.12) }}
          >
            <X size={13} color={theme.onSecondaryContainer} strokeWidth={2.5} />
            <Text
              className="ml-1"
              style={{ color: theme.onSecondaryContainer, fontFamily: SCREEN_FONTS.label, fontSize: 12 }}
            >
              {STRINGS.find_session.filtering.clear}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ height: 4 }} />
    </View>
  ), [loading, isFirstLoad, filteredSessions.length, query, activeAdvancedFiltersCount, preferredCourtFilter, sortMode, handleNearbyFilter, setFilterModalVisible, theme])

  const listFooter = useMemo(() => (
    <SmartQueueBanner 
      smartQueueEnabled={smartQueueEnabled}
      smartQueueHydrated={smartQueueHydrated}
      playerProfile={playerProfile}
      onToggle={applySmartQueueFilters}
      filteredSessionsCount={filteredSessions.length}
      loading={loading}
    />
  ), [loading, filteredSessions.length, smartQueueEnabled, smartQueueHydrated, playerProfile, applySmartQueueFilters])

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      {loading && isFirstLoad ? (
        <View className="flex-1">
          {listHeader}
          <View className="flex-1 items-center justify-center pt-10">
            <ActivityIndicator size="large" color={theme.primary} />
            <Text
              className="mt-4 text-[14px]"
              style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label }}
            >
              {STRINGS.find_session.status.searching}
            </Text>
          </View>
        </View>
      ) : (
        <FlatList
          data={filteredSessions}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={onRefresh} 
              tintColor={theme.primary} 
              colors={[theme.primary]}
              title={STRINGS.find_session.status.refreshing}
              titleColor={theme.onSurfaceVariant}
              progressViewOffset={SPACING.xl}
            />
          }
          alwaysBounceVertical={true}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          renderItem={({ item }) => (
            <View className="px-5 pb-4">
              <SearchResultCard 
                session={item} 
                userLocation={userLocation} // Pass userLocation from state
              />
            </View>
          )}
        />
      )}

      <AdvancedSessionFilterModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        filter={advancedFilter}
        setFilter={setAdvancedFilter}
        onApply={() => setFilterModalVisible(false)}
        onReset={() => setAdvancedFilter(ADVANCED_FILTER_INITIAL)}
        districts={ALL_DISTRICTS}
        skillLevels={SKILL_LEVELS}
      />

      <AppDialog config={dialogConfig} onClose={() => setDialogConfig(null)} />
    </View>
  )
}

// Extract search bar to prevent full header re-memoization on every keystroke
const SearchBar = React.memo(({ 
  query, 
  setQuery, 
  activeAdvancedFiltersCount, 
  onFilterPress, 
  theme 
}: { 
  query: string; 
  setQuery: (q: string) => void; 
  activeAdvancedFiltersCount: number; 
  onFilterPress: () => void; 
  theme: any 
}) => (
  <View className="flex-row items-center px-5 pt-2 pb-4 gap-3">
    <View
      className="flex-1 flex-row items-center h-14 px-4"
      style={{
        backgroundColor: theme.surfaceContainerLow,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.outlineVariant,
      }}
    >
      <Search size={20} color={theme.onSurfaceVariant} strokeWidth={2.4} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={STRINGS.find_session.search_placeholder}
        placeholderTextColor={theme.outline}
        className="flex-1 ml-3"
        style={{
          fontSize: 15,
          fontFamily: SCREEN_FONTS.body,
          color: theme.onSurface,
        }}
      />
      {query.length > 0 ? (
        <Pressable onPress={() => setQuery('')} className="ml-2 p-1">
          <X size={16} color={theme.onSurfaceVariant} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>

    <Pressable
      onPress={onFilterPress}
      className="w-14 h-14 items-center justify-center"
      style={{
        backgroundColor: activeAdvancedFiltersCount > 0 ? theme.primary : theme.surfaceContainerLow,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: activeAdvancedFiltersCount > 0 ? theme.primary : theme.outlineVariant,
      }}
    >
      <SlidersHorizontal
        size={20}
        color={activeAdvancedFiltersCount > 0 ? theme.onPrimary : theme.onSurfaceVariant}
        strokeWidth={2}
      />
      {activeAdvancedFiltersCount > 0 && (
        <View 
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            backgroundColor: theme.primary,
            borderRadius: 10,
            minWidth: 18,
            height: 18,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: theme.background,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 9, fontFamily: SCREEN_FONTS.cta, top: -0.5 }}>
            {activeAdvancedFiltersCount}
          </Text>
        </View>
      )}
    </Pressable>
  </View>
))
SearchBar.displayName = 'SearchBar'
