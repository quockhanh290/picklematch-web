import React, { useEffect, useState } from 'react'
import { 
  View, 
  Text, 
  ScrollView, 
  TouchableOpacity, 
  StatusBar,
  Linking,
  Modal, 
  Dimensions, 
  FlatList,
  Share,
  RefreshControl,
  StyleSheet,
  Alert
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { 
  Star, 
  MapPin, 
  Clock, 
  Navigation, 
  PlusCircle,
  X,
  Phone,
  CalendarDays,
  Quote,
  ChevronRight,
  Share2,
  ChevronLeft,
  Landmark,
  CheckCircle,
} from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { STRINGS } from '@/constants/strings'
import { RADIUS, SPACING, SHADOW } from '@/constants/screenLayout'
import { fetchCourtDetailApi, CourtDetail, CourtReview } from '@/features/player/court/api'
import { isCurrentlyOpen } from '@/lib/utils/court'
import { AppButton, AppInput, AppLoading } from '@/components/design'
import { Image } from 'expo-image'
import { supabase } from '@/lib/supabase'
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  interpolate,
  Extrapolate,
  useAnimatedScrollHandler,
  withSpring,
  withTiming,
  runOnJS
} from 'react-native-reanimated'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')

function withAlpha(hex: string, alpha: number): string {
  if (!hex || !hex.startsWith('#')) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export default function CourtDetailScreen() {
  const { id, mode } = useLocalSearchParams<{ id: string, mode?: 'claim' }>()
  const theme = useAppTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [court, setCourt] = useState<CourtDetail | null>(null)
  
  // Modals State
  const [viewerVisible, setViewerVisible] = useState(false)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [reviewsVisible, setReviewsVisible] = useState(false)
  const [viewerImages, setViewerImages] = useState<string[]>([])

  // Reanimated values
  const scrollY = useSharedValue(0)
  const translateY = useSharedValue(0)
  const opacity = useSharedValue(1)
  const reviewsProgress = useSharedValue(0)

  // Claim State
  const [businessName, setBusinessName] = useState('')
  const [phone, setPhone] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimSuccess, setClaimSuccess] = useState(false)

  useEffect(() => {
    if (id) {
      loadCourtDetail()
    }
  }, [id])

  useEffect(() => {
    reviewsProgress.value = withTiming(reviewsVisible ? 1 : 0, { duration: 300 })
  }, [reviewsVisible])

  async function loadCourtDetail(isRefresh = false) {
    try {
      if (!isRefresh) setLoading(true)
      const data = await fetchCourtDetailApi(id as string)
      setCourt(data)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const onRefresh = () => {
    setRefreshing(true)
    loadCourtDetail(true)
  }

  const handleShare = async () => {
    if (!court) return
    try {
      await Share.share({ message: `Khám phá sân Pickleball ${court.name} tại ${court.address}. Tải PickleMatch ngay!` })
    } catch (e) {
      console.warn('Sharing failed', e)
    }
  }

  const handleOpenMaps = () => {
    if (!court?.google_maps_url && !court?.address) return
    const url = court.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(court.name + ' ' + court.address)}`
    Linking.openURL(url)
  }

  const handleCall = () => {
    if (court?.phone) {
      Linking.openURL(`tel:${court.phone}`)
    }
  }

  const handleExploreSessions = () => {
    if (!court) return
    router.push({
      pathname: '/find-session',
      params: { courtId: court.id, courtName: court.name }
    } as any)
  }

  const handleClaim = async () => {
    if (!businessName || !phone) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập Tên sân và Số điện thoại.')
      return
    }

    setClaiming(true)
    try {
      // For demo purposes, we update the court directly
      // In a real app, this would create an owner record first
      const { error } = await supabase
        .from('courts')
        .update({ 
          owner_id: 'GUEST_OWNER_' + phone, // Placeholder logic
          name: businessName,
          phone: phone
        })
        .eq('id', id)

      if (error) throw error
      setClaimSuccess(true)
      loadCourtDetail()
    } catch (err: any) {
      Alert.alert('Lỗi', err.message || 'Không thể xác nhận chủ sân.')
    } finally {
      setClaiming(false)
    }
  }

  const openImageViewer = (index: number, images: string[]) => {
    setViewerImages(images)
    setSelectedImageIndex(index)
    translateY.value = 0
    opacity.value = 1
    setViewerVisible(true)
  }

  const closeViewer = () => {
    setViewerVisible(false)
  }

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y
  })

  const headerAnimatedStyle = useAnimatedStyle(() => {
    const op = interpolate(scrollY.value, [100, 200], [0, 1], Extrapolate.CLAMP)
    return { opacity: op }
  })

  const backButtonBackgroundStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.outlineVariant,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3
    }
  })

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (event.translationY > 0) {
        translateY.value = event.translationY
        opacity.value = interpolate(translateY.value, [0, 300], [1, 0.5], Extrapolate.CLAMP)
      }
    })
    .onEnd((event) => {
      if (event.translationY > 150 || event.velocityY > 1000) {
        runOnJS(closeViewer)()
      } else {
        translateY.value = withSpring(0)
        opacity.value = withSpring(1)
      }
    })

  const animatedImageStyle = useAnimatedStyle(() => {
    return { transform: [{ translateY: translateY.value }] }
  })

  const animatedBackgroundStyle = useAnimatedStyle(() => {
    return { opacity: opacity.value }
  })

  const reviewsAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: interpolate(reviewsProgress.value, [0, 1], [SCREEN_HEIGHT, 0]) }]
    }
  })

  if (loading) return <AppLoading fullScreen />

  if (!court) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Text style={{ textAlign: 'center', fontSize: 15, fontFamily: SCREEN_FONTS.label, color: theme.onSurfaceVariant }}>{STRINGS.court.not_found}</Text>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline }}>{STRINGS.common.back}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    )
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <StatusBar barStyle="dark-content" />
        
        {/* Floating Header */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, height: insets.top + 60 }}>
          <Animated.View style={[{ position: 'absolute', inset: 0, backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.outlineVariant }, headerAnimatedStyle]} />
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingTop: insets.top }}>
            <TouchableOpacity onPress={() => router.back()}>
              <Animated.View style={[{ width: 40, height: 40, borderRadius: RADIUS.full, alignItems: 'center', justifyContent: 'center' }, backButtonBackgroundStyle]}>
                <ChevronLeft size={24} color={theme.primary} />
              </Animated.View>
            </TouchableOpacity>
            <Animated.View style={[{ flex: 1, marginHorizontal: 12 }, headerAnimatedStyle]}>
              <Text numberOfLines={1} style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 16, textTransform: 'uppercase' }}>{court.name}</Text>
            </Animated.View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={handleShare} style={[{ width: 40, height: 40, borderRadius: RADIUS.full, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.outlineVariant, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 }]}>
                <Share2 size={20} color={theme.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <Animated.ScrollView 
          style={{ flex: 1 }} 
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        >
          {/* 1. PHOTO GALLERY */}
          <View>
            <FlatList
              data={court.images}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={{ width: SCREEN_WIDTH, height: 280 }}
              renderItem={({ item, index }) => (
                <TouchableOpacity activeOpacity={0.9} onPress={() => openImageViewer(index, court.images)} style={{ width: SCREEN_WIDTH, height: 280 }}>
                  <Image source={{ uri: item }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                </TouchableOpacity>
              )}
              keyExtractor={(_, idx) => idx.toString()}
            />
            <View style={{ position: 'absolute', bottom: SPACING.lg, right: SPACING.lg, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.xl }}>
              <Text style={{ color: theme.surface, fontFamily: SCREEN_FONTS.label, fontSize: 12 }}>{court.images.length} {STRINGS.court.photos}</Text>
            </View>
          </View>

          <View style={{ paddingHorizontal: 24, paddingTop: 24 }}>
            {/* 2. MAIN INFO */}
            <View style={{ marginBottom: 24 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <Text style={{ flex: 1, color: theme.onBackground, fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, textTransform: 'uppercase', lineHeight: 32 }}>{court.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.warningContainer, paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.warningStrong }}>
                  <Star size={14} color={theme.warningStrong} fill={theme.warningStrong} />
                  <Text style={{ marginLeft: 4, fontFamily: SCREEN_FONTS.headline, fontSize: 14 }}>{court.rating.toFixed(1)}</Text>
                  <Text style={{ marginLeft: 4, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurfaceVariant }}>({court.rating_count})</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <MapPin size={14} color={theme.onSurfaceVariant} />
                <Text numberOfLines={2} style={{ flex: 1, marginLeft: 8, color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 14 }}>{court.address}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <Clock size={14} color={theme.onSurfaceVariant} />
                <Text style={{ marginLeft: 8, color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 14 }}>
                  {STRINGS.court.hours} <Text style={{ fontFamily: SCREEN_FONTS.headline, color: theme.onSurface }}>
                    {court.hours_open && court.hours_close ? `${court.hours_open} - ${court.hours_close}` : '06:00 - 22:00'}
                  </Text>
                  {'  ·  '}
                  <Text style={{ 
                    fontFamily: SCREEN_FONTS.headline, 
                    color: isCurrentlyOpen(court.hours_open, court.hours_close) ? theme.primary : theme.error 
                  }}>
                    {isCurrentlyOpen(court.hours_open, court.hours_close) ? STRINGS.court.status_open : STRINGS.court.status_closed}
                  </Text>
                </Text>
              </View>

              {/* Sub-actions */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                {court.phone && (
                  <TouchableOpacity onPress={handleCall} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceContainerLow, paddingVertical: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.outlineVariant }}>
                    <Phone size={16} color={theme.primary} />
                    <Text style={{ marginLeft: 8, color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 14 }}>{STRINGS.court.actions.call}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={handleOpenMaps} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceContainerLow, paddingVertical: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.outlineVariant }}>
                  <Navigation size={16} color={theme.primary} />
                  <Text style={{ marginLeft: 8, color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 14 }}>{STRINGS.court.actions.directions}</Text>
                </TouchableOpacity>
              </View>

              {/* Active Sessions Highlight */}
              <TouchableOpacity 
                onPress={handleExploreSessions} 
                style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  backgroundColor: theme.surfaceContainerLow,
                  padding: 16,
                  borderRadius: RADIUS.lg,
                  borderWidth: 1,
                  borderColor: theme.outlineVariant,
                }}
              >
                <View style={{ 
                  width: 36, 
                  height: 36, 
                  borderRadius: RADIUS.md, 
                  backgroundColor: withAlpha(theme.primary, 0.08),
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 14
                }}>
                  <CalendarDays size={18} color={theme.primary} />
                </View>
                
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>{STRINGS.court.actions.explore_sessions}</Text>
                  <Text style={{ color: court.active_sessions_count > 0 ? theme.primary : theme.onSurface, fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 16 }}>
                    {court.active_sessions_count > 0 ? STRINGS.court.sessions.waiting.replace('{count}', court.active_sessions_count.toString()) : STRINGS.court.sessions.empty}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, fontSize: 12 }}>{STRINGS.court.sessions.view}</Text>
                  <ChevronRight size={16} color={theme.primary} />
                </View>
              </TouchableOpacity>

              {/* CLAIM COURT SECTION */}
              {(mode === 'claim' || !court.owner_id) && !claimSuccess && (
                <View style={[styles.claimCard, { backgroundColor: theme.primaryContainer, borderColor: theme.primary }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <Landmark size={24} color={theme.onPrimaryContainer} />
                    <Text style={{ flex: 1, color: theme.onPrimaryContainer, fontFamily: SCREEN_FONTS.headline, fontSize: 18 }}>Xác nhận chủ sân</Text>
                  </View>
                  <Text style={{ color: theme.onPrimaryContainer, opacity: 0.8, fontSize: 13, marginBottom: 20, fontFamily: SCREEN_FONTS.body }}>
                    Bạn có phải là chủ quản của {court.name}? Hãy để lại thông tin để bắt đầu quản lý và tạo kèo Zalo.
                  </Text>
                  
                  <View style={{ gap: 16 }}>
                    <AppInput 
                      placeholder="Tên kinh doanh / Tên sân" 
                      value={businessName} 
                      onChangeText={setBusinessName} 
                      style={{ backgroundColor: theme.surface }}
                    />
                    <AppInput 
                      placeholder="Số điện thoại Zalo" 
                      value={phone} 
                      onChangeText={setPhone} 
                      keyboardType="phone-pad"
                      style={{ backgroundColor: theme.surface }}
                    />
                    <AppButton 
                      label="Xác nhận & Tiếp tục" 
                      onPress={handleClaim} 
                      loading={claiming}
                    />
                  </View>
                </View>
              )}

              {claimSuccess && (
                <View style={[styles.claimCard, { backgroundColor: theme.primary, alignItems: 'center', padding: 32 }]}>
                  <CheckCircle size={48} color="white" />
                  <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 20, marginTop: 16 }}>Xác nhận thành công!</Text>
                  <Text style={{ color: 'white', opacity: 0.9, textAlign: 'center', marginTop: 8, fontSize: 14 }}>
                    Bây giờ bạn có thể bắt đầu tạo kèo và chia sẻ link đăng ký Zalo.
                  </Text>
                  <AppButton 
                    label="Tạo kèo ngay" 
                    variant="secondary"
                    onPress={() => { if (__DEV__) router.push(`/host/web-quick-start?step=create&courtId=${id}`) }}
                    style={{ marginTop: 24, backgroundColor: 'white' }}
                  />
                </View>
              )}
            </View>

            {/* 6. REVIEWS */}
            <Section 
              title={STRINGS.court.reviews.title} 
              theme={theme}
              rightSlot={
                <TouchableOpacity onPress={() => setReviewsVisible(true)}>
                  <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, fontSize: 13 }}>{STRINGS.court.actions.view_all} ({court.reviews.length})</Text>
                </TouchableOpacity>
              }
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -24 }} contentContainerStyle={{ paddingHorizontal: 24, gap: 12 }}>
                {court.reviews.slice(0, 5).map((rev, idx) => (
                  <ReviewCard key={idx} review={rev} width={SCREEN_WIDTH * 0.7} theme={theme} compact onPhotoPress={(imgIdx, imgs) => openImageViewer(imgIdx, imgs)} />
                ))}
                {court.reviews.length > 5 && (
                  <TouchableOpacity onPress={() => setReviewsVisible(true)} style={{ width: 100, height: 120, backgroundColor: theme.surfaceVariant, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
                    <ChevronRight size={20} color={theme.primary} />
                    <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, fontSize: 11, marginTop: 4 }}>{STRINGS.court.actions.see_more}</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </Section>

            <View style={{ height: 160 }} />
          </View>
        </Animated.ScrollView>

        {/* REVIEWS LIST - CUSTOM ANIMATED VIEW TO ALLOW MODAL OVERLAY */}
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.surface, zIndex: 500 }, reviewsAnimatedStyle]}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.xl, paddingTop: Math.max(insets.top, SPACING.lg), paddingBottom: SPACING.lg, borderBottomWidth: 1, borderBottomColor: theme.outlineVariant }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 18 }}>{STRINGS.court.reviews.all_reviews.replace('{count}', court.reviews.length.toString())}</Text>
              <TouchableOpacity onPress={() => setReviewsVisible(false)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: theme.surfaceVariant }}>
                <X color={theme.onSurface} size={24} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={court.reviews}
              keyExtractor={(_, idx) => idx.toString()}
              contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: insets.bottom + 40 }}
              renderItem={({ item }) => <ReviewCard review={item} width="100%" theme={theme} compact onPhotoPress={(imgIdx, imgs) => openImageViewer(imgIdx, imgs)} />}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </Animated.View>

        {/* 7. UPDATED CTA: CREATE SESSION */}
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: SPACING.xl, paddingTop: SPACING.lg, paddingBottom: Math.max(insets.bottom, SPACING.lg), backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.outlineVariant, zIndex: 10 }}>
          <TouchableOpacity 
            onPress={() => router.push({
              pathname: '/create-session',
              params: { 
                courtId: court.id,
                courtName: court.name 
              }
            } as any)} 
            style={{ backgroundColor: theme.primary, height: 58, borderRadius: RADIUS.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: theme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 }}
          >
            <PlusCircle size={22} color={theme.surface} strokeWidth={3} />
            <Text style={{ color: theme.surface, fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 16, textTransform: 'uppercase', letterSpacing: 0.8, marginLeft: 10 }}>{STRINGS.court.actions.create_session}</Text>
          </TouchableOpacity>
        </View>

        {/* IMAGE VIEWER MODAL - Placed at the end to ensure it's on top of EVERYTHING */}
        <Modal visible={viewerVisible} transparent animationType="fade" onRequestClose={closeViewer} statusBarTranslucent>
          <Animated.View style={[{ flex: 1, backgroundColor: '#000' }, animatedBackgroundStyle]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.xl, paddingTop: Math.max(insets.top, SPACING.lg), paddingBottom: SPACING.lg, zIndex: 100 }}>
              <Text style={{ color: theme.surface, fontFamily: SCREEN_FONTS.headline, fontSize: 16 }}>{selectedImageIndex + 1} / {viewerImages.length}</Text>
              <TouchableOpacity onPress={closeViewer} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)' }}>
                <X color={theme.surface} size={26} />
              </TouchableOpacity>
            </View>
            <GestureDetector gesture={panGesture}>
              <Animated.View style={[{ flex: 1, justifyContent: 'center' }, animatedImageStyle]}>
                <FlatList
                  data={viewerImages}
                  horizontal
                  pagingEnabled
                  initialScrollIndex={selectedImageIndex}
                  getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
                  onMomentumScrollEnd={(e) => {
                    const offset = e?.nativeEvent?.contentOffset?.x
                    if (typeof offset === 'number' && SCREEN_WIDTH > 0) {
                      setSelectedImageIndex(Math.round(offset / SCREEN_WIDTH))
                    }
                  }}
                  showsHorizontalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <View style={{ width: SCREEN_WIDTH, height: '100%', justifyContent: 'center' }}>
                      <Image source={{ uri: item }} style={{ width: SCREEN_WIDTH, height: '100%' }} contentFit="contain" />
                    </View>
                  )}
                  keyExtractor={(_, index) => index.toString()}
                />
              </Animated.View>
            </GestureDetector>
          </Animated.View>
        </Modal>
        </View>
    </GestureHandlerRootView>
  )
}

function Section({ title, children, rightSlot, icon, theme }: { title: string, children: React.ReactNode, rightSlot?: React.ReactNode, icon?: React.ReactNode, theme: any }) {
  return (
    <View style={{ marginBottom: 32 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon}
          <Text style={{ color: theme.onBackground, fontFamily: SCREEN_FONTS.headline, fontSize: 18 }}>{title}</Text>
        </View>
        {rightSlot}
      </View>
      {children}
    </View>
  )
}

function ReviewCard({ review, width, compact = false, onPhotoPress, theme }: { review: CourtReview, width: any, compact?: boolean, onPhotoPress?: (idx: number, images: string[]) => void, theme: any }) {
  return (
    <View style={{ width, padding: compact ? 12 : 16, backgroundColor: theme.surfaceContainerLowest, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.outlineVariant }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: compact ? 6 : 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: compact ? 26 : 32, height: compact ? 26 : 32, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.surfaceVariant, alignItems: 'center', justifyContent: 'center' }}>
            {review.profile_picture ? <Image source={{ uri: review.profile_picture }} style={{ width: '100%', height: '100%' }} /> : <Text style={{ fontSize: compact ? 10 : 12, fontFamily: SCREEN_FONTS.headline }}>{review.name[0]}</Text>}
          </View>
          <View style={{ marginLeft: 8 }}>
            <Text numberOfLines={1} style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: compact ? 13 : 14 }}>{review.name}</Text>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 9 }}>{review.when || STRINGS.court.reviews.just_now}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row' }}>
          {[...Array(5)].map((_, i) => (
            <Star key={i} size={compact ? 8 : 10} color={i < review.rating ? theme.warningStrong : theme.outlineVariant} fill={i < review.rating ? theme.warningStrong : 'transparent'} />
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', marginBottom: (review.images && review.images.length > 0) ? 8 : 0 }}>
        <Quote size={compact ? 10 : 12} color={theme.primary} style={{ marginTop: 2, marginRight: 6, opacity: 0.5 }} />
        <Text numberOfLines={compact ? 2 : 3} style={{ flex: 1, color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: compact ? 12 : 13, fontStyle: 'italic', lineHeight: compact ? 16 : 18 }}>
          {review.description || STRINGS.court.reviews.default_review}
        </Text>
      </View>
      {review.images && review.images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }} contentContainerStyle={{ gap: 6 }}>
          {review.images.map((img, idx) => (
            <TouchableOpacity key={idx} onPress={() => onPhotoPress?.(idx, review.images || [])}>
              <Image source={{ uri: img }} style={{ width: 50, height: 50, borderRadius: RADIUS.md }} contentFit="cover" />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  )
}
const styles = StyleSheet.create({
  claimCard: {
    marginTop: 24,
    padding: 20,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    ...SHADOW.md
  }
})
