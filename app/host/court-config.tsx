import { AppDialog, SecondaryNavbar, AppLoading } from '@/components/design'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'
import { router, useLocalSearchParams } from 'expo-router'
import { 
  Landmark, 
  Info, 
  MapPin, 
  Clock, 
  Star, 
  Phone, 
  Navigation,
  ChevronLeft
} from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { StatusBar } from 'expo-status-bar'
import { useState, useEffect } from 'react'
import { 
  Text, 
  TextInput, 
  TouchableOpacity, 
  View, 
  ScrollView,
  Dimensions,
  FlatList,
  Linking
} from 'react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, BORDER, SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { isCurrentlyOpen } from '@/lib/utils/court'
import { fetchCourtDetailApi } from '@/features/player/court/api'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

export default function CourtConfigScreen() {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const { userId } = useAuth()
  const params = useLocalSearchParams()
  const courtId = params.id as string
  
  const [activeCourtId, setActiveCourtId] = useState<string | null>(courtId || null)
  const [court, setCourt] = useState<any>(null)
  const [count, setCount] = useState('4')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchCourtDetails()
  }, [courtId, userId])

  async function fetchCourtDetails() {
    setLoading(true)
    try {
      let finalId = courtId

      // If no ID is passed (e.g. from Settings), fetch the Host's court ID
      if (!finalId) {
        if (userId) {
          const { data: HostCourt } = await supabase
            .from('courts')
            .select('id')
            .eq('owner_id', userId)
            .maybeSingle()

          if (HostCourt) {
            finalId = HostCourt.id
            setActiveCourtId(finalId)
          }
        }
      } else {
        setActiveCourtId(finalId)
      }

      if (!finalId) {
        setLoading(false)
        return
      }

      const data = await fetchCourtDetailApi(finalId)
      if (data) {
        setCourt(data)
        const { data: rawCourt } = await supabase.from('courts').select('sub_court_count').eq('id', finalId).single()
        if (rawCourt?.sub_court_count) {
          setCount(rawCourt.sub_court_count.toString())
        }
      }
    } catch (e) {
      console.error('Error fetching court details:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    const num = parseInt(count, 10)
    if (isNaN(num) || num <= 0) return

    setSaving(true)
    const { error } = await supabase
      .from('courts')
      .update({ sub_court_count: num })
      .eq('id', activeCourtId)

    setSaving(false)
    if (!error) {
      router.replace('/host/dashboard')
    }
  }

  if (loading) return <AppLoading fullScreen />

  const hours_open = court?.hours_open || '06:00'
  const hours_close = court?.hours_close || '22:00'
  const isOpen = isCurrentlyOpen(hours_open, hours_close)
  const handleCall = () => {
    if (court?.phone) {
      void Linking.openURL(`tel:${court.phone}`)
    }
  }
  const handleOpenMaps = () => {
    if (court?.google_maps_url) {
      void Linking.openURL(court.google_maps_url)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="light" />
      
      <ScrollView 
        bounces={false} 
        contentContainerStyle={{ flexGrow: 1 }} 
        showsVerticalScrollIndicator={false}
      >
        <View>
          <FlatList
            data={court?.images || []}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={{ width: SCREEN_WIDTH, height: 300 }}
            renderItem={({ item }) => (
              <View style={{ width: SCREEN_WIDTH, height: 300 }}>
                <Image source={{ uri: item }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              </View>
            )}
            keyExtractor={(_, idx) => idx.toString()}
            ListEmptyComponent={() => (
              <View style={{ width: SCREEN_WIDTH, height: 300, backgroundColor: theme.surfaceVariant, alignItems: 'center', justifyContent: 'center' }}>
                <Landmark size={48} color={theme.outline} />
              </View>
            )}
          />
          
          <TouchableOpacity 
            onPress={() => router.back()}
            style={{ 
              position: 'absolute', 
              top: insets.top + 10, 
              left: 20, 
              width: 40, 
              height: 40, 
              borderRadius: 20, 
              backgroundColor: 'rgba(255,255,255,0.9)',
              alignItems: 'center',
              justifyContent: 'center',
              ...LAYOUT_SHADOW.sm
            }}
          >
            <ChevronLeft size={24} color={theme.primary} />
          </TouchableOpacity>

          <View style={{ position: 'absolute', bottom: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: RADIUS.xl }}>
            <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.label, fontSize: 12 }}>{court?.images?.length || 0} ẢNH</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 24, paddingTop: 24 }}>
          <View style={{ marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <Text style={{ flex: 1, color: theme.onBackground, fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 28, textTransform: 'uppercase', lineHeight: 32 }}>
                {court?.name}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF9C4', paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.md, borderWidth: 1, borderColor: '#FBC02D' }}>
                <Star size={14} color="#FBC02D" fill="#FBC02D" />
                <Text style={{ marginLeft: 4, fontFamily: SCREEN_FONTS.headline, fontSize: 14 }}>{court?.rating?.toFixed(1) || '5.0'}</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ width: 32, height: 32, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
                <MapPin size={16} color="white" />
              </View>
              <Text numberOfLines={2} style={{ flex: 1, marginLeft: 12, color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 14 }}>
                {court?.address}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
              <View style={{ width: 32, height: 32, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Clock size={16} color="white" />
              </View>
              <Text style={{ marginLeft: 12, color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 14 }}>
                Giờ mở cửa: <Text style={{ fontFamily: SCREEN_FONTS.headline, color: theme.onSurface }}>
                  {hours_open} - {hours_close}
                </Text>
                {'  ·  '}
                <Text style={{ 
                  fontFamily: SCREEN_FONTS.headline, 
                  color: isOpen ? theme.primary : theme.error 
                }}>
                  {isOpen ? 'ĐANG MỞ CỬA' : 'ĐÃ ĐÓNG CỬA'}
                </Text>
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 32 }}>
              <TouchableOpacity onPress={handleCall} disabled={!court?.phone} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceContainerLow, paddingVertical: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.outlineVariant, opacity: court?.phone ? 1 : 0.55 }}>
                <Phone size={16} color={theme.primary} />
                <Text style={{ marginLeft: 8, color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 14 }}>GỌI ĐIỆN</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleOpenMaps} disabled={!court?.google_maps_url} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceContainerLow, paddingVertical: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.outlineVariant, opacity: court?.google_maps_url ? 1 : 0.55 }}>
                <Navigation size={16} color={theme.primary} />
                <Text style={{ marginLeft: 8, color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 14 }}>CHỈ ĐƯỜNG</Text>
              </TouchableOpacity>
            </View>

            <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginBottom: 32 }} />

            <View style={{ 
              backgroundColor: theme.surface, 
              padding: 24, 
              borderRadius: RADIUS.xl,
              borderWidth: 1,
              borderColor: theme.outlineVariant,
              ...LAYOUT_SHADOW.sm
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <View style={{ 
                  width: 40, 
                  height: 40, 
                  borderRadius: RADIUS.md, 
                  backgroundColor: theme.primary, 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}>
                  <Landmark size={20} color="white" />
                </View>
                <Text style={{ marginLeft: 12, fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 18, color: theme.onSurface }}>
                  CẤU HÌNH SÂN CON
                </Text>
              </View>
              
              <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.onSurfaceVariant, marginBottom: 24, lineHeight: 20 }}>
                Xác nhận số lượng sân con đang hoạt động để hệ thống hiển thị lịch trình chính xác.
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                    TỔNG SỐ SÂN CON
                  </Text>
                  <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurfaceVariant }}>
                    Ví dụ: 2 sân, 4 sân...
                  </Text>
                </View>

                <View style={{ 
                  backgroundColor: theme.surfaceAlt,
                  borderRadius: RADIUS.lg,
                  borderWidth: 2,
                  borderColor: theme.primary,
                  width: 100,
                  height: 64,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <TextInput
                    value={count}
                    onChangeText={setCount}
                    keyboardType="number-pad"
                    placeholder="0"
                    style={{
                      color: theme.primary,
                      fontSize: 28,
                      fontFamily: SCREEN_FONTS.headline,
                      textAlign: 'center',
                      width: '100%'
                    }}
                  />
                </View>
              </View>

              <View style={{ 
                flexDirection: 'row', 
                marginTop: 24, 
                backgroundColor: theme.surfaceContainerLow,
                padding: 12,
                borderRadius: RADIUS.md,
                gap: 12,
                borderStyle: 'dashed',
                borderWidth: 1,
                borderColor: theme.outlineVariant,
                alignItems: 'center'
              }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Info size={14} color="white" />
                </View>
                <Text style={{ flex: 1, color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 18 }}>
                  Mỗi sân con có thể tổ chức 1 trận đấu 4 người cùng lúc.
                </Text>
              </View>
            </View>
          </View>
          
          <View style={{ height: 100 }} />
        </View>
      </ScrollView>

      <View style={{ 
        position: 'absolute', 
        bottom: 0, 
        left: 0, 
        right: 0, 
        padding: 24, 
        paddingBottom: Math.max(insets.bottom, 24),
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderTopColor: theme.outlineVariant,
        ...LAYOUT_SHADOW.lg
      }}>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={{
            height: 60,
            backgroundColor: theme.primary,
            borderRadius: RADIUS.lg,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: theme.primary,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 4,
            opacity: saving ? 0.7 : 1
          }}
        >
          <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 16, textTransform: 'uppercase', letterSpacing: 1 }}>
            {saving ? 'ĐANG LƯU DỮ LIỆU...' : 'XÁC NHẬN & HOÀN TẤT'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
