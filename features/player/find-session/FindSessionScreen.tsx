import React, { useMemo } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Platform,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import {
  Navigation,
  Search,
  SlidersHorizontal,
  X,
  Activity,
  Sliders,
} from 'lucide-react-native'
import { 
  AppDialog, 
  MainHeader 
} from '@/components/design'
import { AdvancedSessionFilterModal, ADVANCED_FILTER_INITIAL } from '@/components/find-session/AdvancedSessionFilterModal'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, SHADOW, BORDER } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { useAppTheme } from '@/lib/theme-context'
import { ALL_DISTRICTS, SKILL_LEVELS } from '@/constants/systemData'

import { useFindSessionController } from './hooks/useFindSessionController'
import { SearchResultCard } from './components/SearchResultCard'
import { SmartQueueBanner } from './components/SmartQueueBanner'
import { withAlpha } from './utils'
import { WebContainer } from '@/components/design/WebContainer'

export function FindSessionScreen() {
  const isWeb = Platform.OS === 'web'
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

  const { width } = useWindowDimensions()
  const isMobile = width < 768
  const isDesktop = width >= 1024

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

  const sidebar = useMemo(() => (
    <View style={{ width: 280, paddingRight: 32, display: isMobile ? 'none' : 'flex' }}>
      <View style={{ 
        backgroundColor: 'white', 
        borderRadius: RADIUS.xl, 
        padding: 24,
        borderWidth: 1,
        borderColor: theme.outlineVariant,
        ...SHADOW.sm
      }}>
        <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.label, color: theme.outline, marginBottom: 24, textTransform: 'uppercase', letterSpacing: 2 }}>
          LỌC KÈO ĐẤU
        </Text>
        
        {/* District Filter */}
        <View style={{ marginBottom: 32 }}>
          <Text style={{ fontSize: 13, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface, marginBottom: 14, letterSpacing: 0.5 }}>
            QUẬN / HUYỆN
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ALL_DISTRICTS.slice(0, 8).map(d => (
              <TouchableOpacity
                key={d}
                onPress={() => setAdvancedFilter(f => ({ ...f, district: f.district === d ? null : d }))}
                style={{
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.lg,
                  backgroundColor: advancedFilter.district === d ? theme.primary : theme.surfaceAlt,
                  borderWidth: 1, borderColor: advancedFilter.district === d ? theme.primary : theme.outlineVariant
                }}
              >
                <Text style={{ 
                  fontSize: 12, fontFamily: SCREEN_FONTS.label, 
                  color: advancedFilter.district === d ? 'white' : theme.onSurfaceVariant 
                }}>
                  {d}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Skill Level Filter */}
        <View style={{ marginBottom: 32 }}>
          <Text style={{ fontSize: 13, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface, marginBottom: 14, letterSpacing: 0.5 }}>
            TRÌNH ĐỘ (SLOT)
          </Text>
          <View style={{ gap: 10 }}>
            {SKILL_LEVELS.map(level => (
              <TouchableOpacity
                key={level.id}
                onPress={() => setAdvancedFilter(f => ({ ...f, skillLevel: f.skillLevel === level.id ? null : level.id }))}
                style={{
                  flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: RADIUS.lg,
                  backgroundColor: advancedFilter.skillLevel === level.id ? theme.primary : theme.surfaceAlt,
                  borderWidth: 1, borderColor: advancedFilter.skillLevel === level.id ? theme.primary : theme.outlineVariant
                }}
              >
                <View style={{ 
                  width: 6, height: 6, borderRadius: 3, 
                  backgroundColor: advancedFilter.skillLevel === level.id ? 'white' : theme.primary,
                  marginRight: 12
                }} />
                <Text style={{ 
                  fontSize: 13, fontFamily: SCREEN_FONTS.label, 
                  color: advancedFilter.skillLevel === level.id ? 'white' : theme.onSurface 
                }}>
                  {level.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity 
          onPress={() => setAdvancedFilter(ADVANCED_FILTER_INITIAL)}
          style={{ 
            marginTop: 16, padding: 16, alignItems: 'center', 
            borderWidth: 1, borderColor: theme.outlineVariant, borderRadius: RADIUS.lg,
            backgroundColor: theme.surfaceAlt
          }}
        >
          <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.cta, fontSize: 12, letterSpacing: 1 }}>
            LÀM MỚI BỘ LỌC
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  ), [isMobile, theme, advancedFilter, setAdvancedFilter])

  const numColumns = isMobile ? 1 : (isDesktop ? 3 : 2)

  return (
    <View style={{ flex: 1, backgroundColor: '#F8F6F1' }}>
      <WebContainer>
        <View style={{ flexDirection: isMobile ? 'column' : 'row', paddingTop: isMobile ? 0 : 48 }}>
          {sidebar}

          <View style={{ flex: 1 }}>
            <FlatList
              data={filteredSessions}
              keyExtractor={(item) => item.id}
              key={`${isMobile ? 'mobile' : 'desktop'}-${numColumns}`}
              numColumns={numColumns}
              columnWrapperStyle={numColumns > 1 ? { gap: 24 } : undefined}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ 
                paddingBottom: 100,
                paddingHorizontal: isMobile ? 20 : 0 
              }}
              refreshControl={
                <RefreshControl 
                  refreshing={refreshing} 
                  onRefresh={onRefresh} 
                  tintColor={theme.primary} 
                />
              }
              ListHeaderComponent={
                <View style={{ marginBottom: 32, paddingTop: isMobile ? 24 : 0 }}>
                  <MainHeader
                    title="TÌM KÈO GIAO LƯU"
                    subtitle={loading && isFirstLoad ? STRINGS.common.loading : `Tìm thấy ${filteredSessions.length} kèo đấu phù hợp`}
                    rightElement={
                      <TouchableOpacity
                        onPress={() => void handleNearbyFilter()}
                        style={{
                          height: 56, width: 56, alignItems: 'center', justifyContent: 'center',
                          borderRadius: RADIUS.full, backgroundColor: 'white',
                          borderWidth: 1, borderColor: theme.outlineVariant,
                          ...SHADOW.sm
                        }}
                      >
                        <Navigation size={22} color={theme.primary} strokeWidth={2.5} />
                      </TouchableOpacity>
                    }
                  />

                  <SearchBar 
                    query={query}
                    setQuery={setQuery}
                    activeAdvancedFiltersCount={activeAdvancedFiltersCount}
                    onFilterPress={() => setFilterModalVisible(true)}
                    theme={theme}
                  />

                  {/* Sorting Tabs - Dashboard Style */}
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 8 }}>
                    <View style={{
                      flexDirection: 'row', gap: 6, padding: 6,
                      backgroundColor: 'white', borderRadius: RADIUS.xl,
                      borderWidth: 1, borderColor: theme.outlineVariant,
                      flex: isDesktop ? 0 : 1, minWidth: isDesktop ? 340 : undefined,
                      ...SHADOW.xs
                    }}>
                      <TouchableOpacity
                        onPress={() => setSortMode('match')}
                        style={{
                          flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10,
                          backgroundColor: sortMode === 'match' ? theme.primary : 'transparent',
                          borderRadius: RADIUS.lg,
                        }}
                      >
                        <Text style={{
                          color: sortMode === 'match' ? 'white' : theme.onSurfaceVariant,
                          fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 12, letterSpacing: 0.5
                        }}>
                          PHÙ HỢP NHẤT
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => setSortMode('time')}
                        style={{
                          flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10,
                          backgroundColor: sortMode === 'time' ? theme.primary : 'transparent',
                          borderRadius: RADIUS.lg,
                        }}
                      >
                        <Text style={{
                          color: sortMode === 'time' ? 'white' : theme.onSurfaceVariant,
                          fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 12, letterSpacing: 0.5
                        }}>
                          MỚI NHẤT
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {preferredCourtFilter && (
                    <View style={{
                      marginTop: 24, backgroundColor: theme.secondaryContainer, borderRadius: RADIUS.xl,
                      padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
                      borderWidth: 1, borderColor: theme.primaryContainer, ...SHADOW.xs
                    }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.cta, fontSize: 10, letterSpacing: 2.2, textTransform: 'uppercase' }}>
                          ƯU TIÊN THEO CƠ SỞ
                        </Text>
                        <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 16, marginTop: 4 }}>
                          {preferredCourtFilter.name}
                        </Text>
                      </View>
                      <TouchableOpacity 
                        onPress={clearCourtFilter} 
                        style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'white', borderRadius: RADIUS.full, ...SHADOW.xs }}
                      >
                        <X size={16} color={theme.primary} strokeWidth={3} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              }
              ListFooterComponent={listFooter}
              ListEmptyComponent={
                !loading && (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', pt: 100, px: 40 }}>
                    <View style={{ 
                      width: 120, height: 120, borderRadius: 60, backgroundColor: 'white', 
                      alignItems: 'center', justifyContent: 'center', marginBottom: 28,
                      borderWidth: 1, borderColor: theme.outlineVariant, ...SHADOW.sm
                    }}>
                      <Activity size={56} color={theme.outline} strokeWidth={1} />
                    </View>
                    <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 24, color: theme.onSurface, textAlign: 'center' }}>
                      Rất tiếc, không thấy kèo nào!
                    </Text>
                    <Text style={{ marginTop: 14, fontFamily: SCREEN_FONTS.body, fontSize: 16, color: theme.onSurfaceVariant, textAlign: 'center', lineHeight: 24, maxWidth: 320 }}>
                      Hãy thử mở rộng phạm vi tìm kiếm hoặc quay lại sau ít phút nhé.
                    </Text>
                    <TouchableOpacity 
                      onPress={() => setAdvancedFilter(ADVANCED_FILTER_INITIAL)}
                      style={{ marginTop: 36, paddingHorizontal: 40, paddingVertical: 16, backgroundColor: theme.primary, borderRadius: RADIUS.full, ...SHADOW.sm }}
                    >
                      <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.cta, fontSize: 14, letterSpacing: 1 }}>LÀM MỚI BỘ LỌC</Text>
                    </TouchableOpacity>
                  </View>
                )
              }
              renderItem={({ item }) => (
                <View style={{ 
                  flex: 1, 
                  marginBottom: isMobile ? 16 : 24 
                }}>
                  <SearchResultCard session={item} userLocation={userLocation} />
                </View>
              )}
            />
          </View>
        </View>
      </WebContainer>

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
}) => {
  const { width } = useWindowDimensions()
  const isMobile = width < 768

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingBottom: isMobile ? 16 : 28, gap: isMobile ? 12 : 16 }}>
      <View
        style={{
          flex: 1, flexDirection: 'row', alignItems: 'center', height: isMobile ? 56 : 64, paddingHorizontal: isMobile ? 16 : 24,
          backgroundColor: 'white',
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: theme.outlineVariant,
          ...SHADOW.xs
        }}
      >
        <Search size={isMobile ? 20 : 24} color={theme.primary} strokeWidth={2.5} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={STRINGS.find_session.search_placeholder}
          placeholderTextColor={theme.outline}
          style={{
            flex: 1, marginLeft: isMobile ? 12 : 16,
            fontSize: 16,
            fontFamily: SCREEN_FONTS.body,
            color: theme.onSurface,
            outlineStyle: 'none' // For web
          } as any}
        />
        {query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery('')} style={{ marginLeft: 8, padding: 4 }}>
            <X size={isMobile ? 18 : 20} color={theme.outline} strokeWidth={2.4} />
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={onFilterPress}
        style={{
          width: isMobile ? 56 : 64, height: isMobile ? 56 : 64, alignItems: 'center', justifyContent: 'center',
          backgroundColor: activeAdvancedFiltersCount > 0 ? theme.primary : 'white',
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: activeAdvancedFiltersCount > 0 ? theme.primary : theme.outlineVariant,
          ...SHADOW.xs
        }}
      >
        <SlidersHorizontal
          size={isMobile ? 20 : 24}
          color={activeAdvancedFiltersCount > 0 ? 'white' : theme.onSurfaceVariant}
          strokeWidth={2}
        />
        {activeAdvancedFiltersCount > 0 && (
          <View 
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              backgroundColor: theme.primary,
              borderRadius: 12,
              minWidth: isMobile ? 20 : 24,
              height: isMobile ? 20 : 24,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 3,
              borderColor: 'white',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: isMobile ? 9 : 11, fontFamily: SCREEN_FONTS.bold, top: -0.5 }}>
              {activeAdvancedFiltersCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  )
})
SearchBar.displayName = 'SearchBar'
