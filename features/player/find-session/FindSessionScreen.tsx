import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
  MainHeader,
  AppLoading
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
  const { t } = useTranslation()
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
        title={t('find_session_screen.header_title')}
        subtitle={loading && isFirstLoad ? t('find_session_screen.loading_matches') : t('find_session_screen.matches_found', { count: filteredSessions.length })}
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
        backgroundColor: 'transparent', 
        borderRadius: RADIUS.xl, 
        padding: 24,
        borderWidth: 1,
        borderColor: theme.outlineVariant,
      }}>
        <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.label, color: theme.outline, marginBottom: 24, textTransform: 'uppercase', letterSpacing: 2 }}>
          {t('find_session_screen.filter_header')}
        </Text>
        

        {/* Skill Level Filter */}
        <View style={{ marginBottom: 32 }}>
          <Text style={{ fontSize: 13, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface, marginBottom: 14, letterSpacing: 0.5 }}>
            {t('find_session_screen.skill_filter')}
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
                  backgroundColor: advancedFilter.skillLevel === level.id ? theme.onPrimary : theme.primary,
                  marginRight: 12
                }} />
                <Text style={{ 
                  fontSize: 13, fontFamily: SCREEN_FONTS.label, 
                  color: advancedFilter.skillLevel === level.id ? theme.onPrimary : theme.onSurface 
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
            {t('find_session_screen.reset_filter')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  ), [isMobile, theme, advancedFilter, setAdvancedFilter])

  const numColumns = isMobile ? 1 : (isDesktop ? 3 : 2)

  return (
    <View style={{ 
      flex: 1, 
      backgroundColor: theme.background,
      ...(Platform.OS === 'web' ? { minHeight: '100dvh' } : {})
    }}>
      <View style={{ backgroundColor: 'transparent', paddingTop: isMobile ? 0 : 24 }}>
        <MainHeader
          title={t('find_session_screen.header_title')}
          brandedSubtitle={t('find_session_screen.header_subtitle')}
          style={{ backgroundColor: 'transparent' }}
          rightElement={
            <TouchableOpacity
              onPress={() => void handleNearbyFilter()}
              style={{
                height: 52, width: 52, alignItems: 'center', justifyContent: 'center',
                borderRadius: RADIUS.full, backgroundColor: theme.surface,
                borderWidth: 1, borderColor: theme.outlineVariant,
                marginRight: isMobile ? 0 : SPACING.xl,
                ...SHADOW.xs
              }}
            >
              <Navigation size={20} color={theme.primary} strokeWidth={2.5} />
            </TouchableOpacity>
          }
        />

        <WebContainer>
          <View style={{ marginTop: -6, marginBottom: 8 }}>
            <Text style={{ 
              fontFamily: SCREEN_FONTS.body, 
              fontSize: 13, 
              color: theme.onSurfaceVariant 
            }}>
              {loading && isFirstLoad ? t('find_session_screen.loading_matches') : t('find_session_screen.matches_found', { count: filteredSessions.length })}
            </Text>
          </View>

        </WebContainer>
      </View>

      <WebContainer>
        {preferredCourtFilter && (
          <View style={{
            marginTop: 8, marginBottom: 16, backgroundColor: theme.secondaryContainer, borderRadius: RADIUS.xl,
            padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14,
            borderWidth: 1, borderColor: theme.primaryContainer, ...SHADOW.xs
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.cta, fontSize: 10, letterSpacing: 2.2, textTransform: 'uppercase' }}>
                {t('find_session_screen.priority_court')}
              </Text>
              <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 16, marginTop: 4 }}>
                {preferredCourtFilter.name}
              </Text>
            </View>
            <TouchableOpacity 
              onPress={clearCourtFilter} 
              style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface, borderRadius: RADIUS.full, ...SHADOW.xs }}
            >
              <X size={16} color={theme.primary} strokeWidth={3} />
            </TouchableOpacity>
          </View>
        )}

        <View style={{ 
          flexDirection: isMobile ? 'column' : 'row', 
          paddingTop: isMobile ? 0 : 24,
          backgroundColor: theme.background
        }}>
          {sidebar}

          <View style={{ flex: 1 }}>
            <View style={{ paddingHorizontal: isMobile ? 20 : 0 }}>
              <SearchBar 
                query={query}
                setQuery={setQuery}
                activeAdvancedFiltersCount={activeAdvancedFiltersCount}
                onFilterPress={() => setFilterModalVisible(true)}
                theme={theme}
              />

              {/* Sorting Tabs - Dashboard Style */}
              <View style={{ flexDirection: 'row', marginTop: -4, marginBottom: 24 }}>
                <View style={{
                  flexDirection: 'row', 
                  backgroundColor: theme.surfaceContainerHighest, 
                  borderRadius: RADIUS.lg, 
                  padding: 4,
                  gap: 4,
                  flex: isDesktop ? 0 : 1, 
                  minWidth: isDesktop ? 300 : undefined,
                }}>
                  <TouchableOpacity
                    onPress={() => setSortMode('match')}
                    style={{
                      flex: 1, 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      paddingVertical: 10,
                      borderRadius: RADIUS.md,
                      backgroundColor: sortMode === 'match' ? theme.surface : 'transparent',
                      ...(sortMode === 'match' ? {
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
                      color: sortMode === 'match' ? theme.primary : theme.onSurfaceVariant,
                      letterSpacing: 0.5
                    }}>
                      {t('find_session_screen.sort_relevance')}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setSortMode('time')}
                    style={{
                      flex: 1, 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      paddingVertical: 10,
                      borderRadius: RADIUS.md,
                      backgroundColor: sortMode === 'time' ? theme.surface : 'transparent',
                      ...(sortMode === 'time' ? {
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
                      color: sortMode === 'time' ? theme.primary : theme.onSurfaceVariant,
                      letterSpacing: 0.5
                    }}>
                      {t('find_session_screen.sort_latest')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            {loading && isFirstLoad ? (
              <AppLoading label={t('find_session_screen.loading_matches')} style={{ marginTop: 60 }} />
            ) : (
              <FlatList
                data={filteredSessions}
              keyExtractor={(item) => item.id}
              key={`${isMobile ? 'mobile' : 'desktop'}-${numColumns}`}
              numColumns={numColumns}
              columnWrapperStyle={numColumns > 1 ? { gap: 16 } : undefined}
              showsVerticalScrollIndicator={false}
              style={{ backgroundColor: theme.background }}
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
              ListFooterComponent={listFooter}
              ListEmptyComponent={
                !loading && (
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 100, paddingHorizontal: 40 }}>
                    <View style={{ 
                      width: 120, height: 120, borderRadius: 60, backgroundColor: theme.surface, 
                      alignItems: 'center', justifyContent: 'center', marginBottom: 28,
                      borderWidth: 1, borderColor: theme.outlineVariant, ...SHADOW.sm
                    }}>
                      <Activity size={56} color={theme.outline} strokeWidth={1} />
                    </View>
                    <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 24, color: theme.onSurface, textAlign: 'center' }}>
                      {t('find_session_screen.empty_title')}
                    </Text>
                    <Text style={{ marginTop: 14, fontFamily: SCREEN_FONTS.body, fontSize: 16, color: theme.onSurfaceVariant, textAlign: 'center', lineHeight: 24, maxWidth: 320 }}>
                      {t('find_session_screen.empty_desc')}
                    </Text>
                    <TouchableOpacity 
                      onPress={() => setAdvancedFilter(ADVANCED_FILTER_INITIAL)}
                      style={{ marginTop: 36, paddingHorizontal: 40, paddingVertical: 16, backgroundColor: theme.primary, borderRadius: RADIUS.full, ...SHADOW.sm }}
                    >
                      <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.cta, fontSize: 14, letterSpacing: 1 }}>{t('find_session_screen.reset_filter')}</Text>
                    </TouchableOpacity>
                  </View>
                )
              }
              renderItem={({ item }) => (
                <View style={{ 
                  flex: 1, 
                  marginBottom: isMobile ? 12 : 16 
                }}>
                  <SearchResultCard session={item} userLocation={userLocation} />
                </View>
              )}
            />
          )}
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
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: isMobile ? 12 : 20, gap: isMobile ? 10 : 12 }}>
      <View
        style={{
          flex: 1, flexDirection: 'row', alignItems: 'center', height: isMobile ? 48 : 52, paddingHorizontal: isMobile ? 12 : 20,
          backgroundColor: theme.surface,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: theme.outlineVariant,
          ...SHADOW.xs
        }}
      >
        <Search size={isMobile ? 18 : 20} color={theme.primary} strokeWidth={2.5} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={STRINGS.find_session.search_placeholder}
          placeholderTextColor={theme.outline}
          style={{
            flex: 1, marginLeft: isMobile ? 10 : 14,
            fontSize: isMobile ? 14 : 15,
            fontFamily: SCREEN_FONTS.body,
            color: theme.onSurface,
            outlineStyle: 'none' // For web
          } as any}
        />
        {query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery('')} style={{ marginLeft: 8, padding: 4 }}>
            <X size={isMobile ? 16 : 18} color={theme.outline} strokeWidth={2.4} />
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={onFilterPress}
        style={{
          width: isMobile ? 48 : 52, height: isMobile ? 48 : 52, alignItems: 'center', justifyContent: 'center',
          backgroundColor: activeAdvancedFiltersCount > 0 ? theme.primary : theme.surface,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: activeAdvancedFiltersCount > 0 ? theme.primary : theme.outlineVariant,
          ...SHADOW.xs
        }}
      >
        <SlidersHorizontal
          size={isMobile ? 18 : 20}
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
              minWidth: isMobile ? 18 : 20,
              height: isMobile ? 18 : 20,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: theme.surface,
            }}
          >
            <Text style={{ color: theme.onPrimary, fontSize: isMobile ? 8 : 10, fontFamily: SCREEN_FONTS.bold, top: -0.5 }}>
              {activeAdvancedFiltersCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  )
})
SearchBar.displayName = 'SearchBar'
