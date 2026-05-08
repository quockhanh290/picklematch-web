import { SecondaryNavbar } from '@/components/design'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'
import { router } from 'expo-router'
import { Search, MapPin, ChevronRight, CheckCircle2, Landmark, Smartphone } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { StatusBar } from 'expo-status-bar'
import { useState, useEffect } from 'react'
import { 
  FlatList, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  View, 
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function ClaimCourtScreen() {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const { userId, isLoading: authLoading } = useAuth()
  
  // Registration State
  const [isOwnerRegistered, setIsOwnerRegistered] = useState<boolean | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [registering, setRegistering] = useState(false)

  // Search State
  const [search, setSearch] = useState('')
  const [courts, setCourts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    checkOwnerStatus()
  }, [authLoading, userId])

  async function checkOwnerStatus() {
    if (!userId) return

    const { data } = await supabase.from('owners').select('id').eq('id', userId).maybeSingle()
    setIsOwnerRegistered(!!data)
    if (data) {
      fetchCourts()
    }
  }

  async function handleRegisterOwner() {
    if (!businessName) return
    if (!userId) return
    setRegistering(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setRegistering(false)
      return
    }

    const { error } = await supabase.from('owners').insert({
      id: user.id,
      business_name: businessName,
      contact_phone: contactPhone || user.phone,
      contact_email: user.email
    })

    setRegistering(false)
    if (!error) {
      setIsOwnerRegistered(true)
      fetchCourts()
    }
  }

  async function fetchCourts() {
    setLoading(true)
    let query = supabase
      .from('courts')
      .select('id, name, district, city, address, owner_id')
      .is('owner_id', null)
      
    if (search) {
      query = query.ilike('name', `%${search}%`)
    }

    const { data, error } = await query.limit(20)
    setLoading(false)
    if (!error) {
      setCourts(data || [])
    }
  }

  useEffect(() => {
    if (isOwnerRegistered) {
      const timer = setTimeout(() => {
        fetchCourts()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [search, isOwnerRegistered])

  async function handleClaim(courtId: string) {
    if (!userId) return

    setClaimingId(courtId)
    const { error } = await supabase
      .from('courts')
      .update({ owner_id: userId })
      .eq('id', courtId)

    if (!error) {
      router.push({ pathname: '/owner/court-config', params: { id: courtId } } as any)
    } else {
      setClaimingId(null)
    }
  }

  if (isOwnerRegistered === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    )
  }

  if (!isOwnerRegistered) {
    return (
      <KeyboardAvoidingView 
        style={{ flex: 1, backgroundColor: theme.background }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <StatusBar style="dark" />
        <SecondaryNavbar title="ĐĂNG KÝ CHỦ SÂN" onBackPress={() => router.replace('/owner/login')} />
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 20 }}>
          <View style={{ 
            width: 64, 
            height: 64, 
            borderRadius: RADIUS.xl, 
            backgroundColor: theme.primaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24
          }}>
            <Landmark size={32} color={theme.primary} />
          </View>

          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 32, color: theme.onSurface, lineHeight: 38 }}>
            {STRINGS.owner_flow.register_owner}
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 16, color: theme.onSurfaceVariant, marginTop: 8, lineHeight: 24 }}>
            Vui lòng hoàn thiện hồ sơ kinh doanh để bắt đầu quản lý sân của bạn trên hệ thống.
          </Text>

          <View style={{ marginTop: 40, gap: 20 }}>
            <View>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: theme.primary, textTransform: 'uppercase', marginBottom: 8 }}>
                {STRINGS.owner_flow.business_name}
              </Text>
              <TextInput
                value={businessName}
                onChangeText={setBusinessName}
                placeholder={STRINGS.owner_flow.business_name_placeholder}
                placeholderTextColor={theme.outline}
                style={{
                  backgroundColor: theme.surfaceAlt,
                  borderRadius: RADIUS.md,
                  padding: 16,
                  fontFamily: SCREEN_FONTS.body,
                  fontSize: 16,
                  color: theme.onSurface,
                  borderWidth: BORDER.base,
                  borderColor: theme.outlineVariant
                }}
              />
            </View>

            <View>
              <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: theme.primary, textTransform: 'uppercase', marginBottom: 8 }}>
                {STRINGS.owner_flow.contact_phone}
              </Text>
              <TextInput
                value={contactPhone}
                onChangeText={setContactPhone}
                keyboardType="phone-pad"
                placeholder="09xx xxx xxx"
                placeholderTextColor={theme.outline}
                style={{
                  backgroundColor: theme.surfaceAlt,
                  borderRadius: RADIUS.md,
                  padding: 16,
                  fontFamily: SCREEN_FONTS.body,
                  fontSize: 16,
                  color: theme.onSurface,
                  borderWidth: BORDER.base,
                  borderColor: theme.outlineVariant
                }}
              />
            </View>
          </View>

          <TouchableOpacity
            onPress={handleRegisterOwner}
            disabled={registering || !businessName}
            style={{
              marginTop: 40,
              height: 60,
              backgroundColor: theme.primary,
              borderRadius: RADIUS.md,
              alignItems: 'center',
              justifyContent: 'center',
              ...SHADOW.md,
              opacity: (registering || !businessName) ? 0.7 : 1
            }}
          >
            <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.cta, fontSize: 16, textTransform: 'uppercase', letterSpacing: 1 }}>
              {registering ? 'ĐANG ĐĂNG KÝ...' : 'TIẾP TỤC'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="dark" />
      <SecondaryNavbar 
        title={STRINGS.owner_flow.claim_title}
        onBackPress={() => setIsOwnerRegistered(false)}
      />
      
      <View style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
        <View style={{ 
          flexDirection: 'row', 
          alignItems: 'center', 
          backgroundColor: theme.surfaceContainerLow,
          borderRadius: RADIUS.md,
          paddingHorizontal: 16,
          height: 52,
          borderWidth: BORDER.base,
          borderColor: theme.outlineVariant
        }}>
          <Search size={20} color={theme.outline} />
          <TextInput
            placeholder={STRINGS.owner_flow.search_court}
            placeholderTextColor={theme.outline}
            value={search}
            onChangeText={setSearch}
            style={{
              flex: 1,
              marginLeft: 12,
              color: theme.onSurface,
              fontFamily: SCREEN_FONTS.body,
              fontSize: 16
            }}
          />
        </View>
      </View>

      {loading && courts.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={courts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 20, paddingTop: 0, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => handleClaim(item.id)}
              disabled={!!claimingId}
              style={{
                backgroundColor: theme.surface,
                borderRadius: RADIUS.lg,
                padding: 16,
                borderWidth: BORDER.base,
                borderColor: theme.outlineVariant,
                flexDirection: 'row',
                alignItems: 'center',
                ...SHADOW.xs
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.onSurface }}>
                  {item.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  <MapPin size={14} color={theme.onSurfaceVariant} />
                  <Text style={{ 
                    fontFamily: SCREEN_FONTS.body, 
                    fontSize: 13, 
                    color: theme.onSurfaceVariant,
                    marginLeft: 4
                  }}>
                    {`${item.district}, ${item.city}`}
                  </Text>
                </View>
              </View>
              
              <View style={{ 
                backgroundColor: theme.primary,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: RADIUS.md,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6
              }}>
                {claimingId === item.id ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.cta, fontSize: 12 }}>
                      {STRINGS.owner_flow.claim_action.toUpperCase()}
                    </Text>
                    <ChevronRight size={14} color="white" />
                  </>
                )}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={() => !loading && (
            <View style={{ flex: 1, alignItems: 'center', marginTop: 100 }}>
              <Text style={{ color: theme.outline, fontFamily: SCREEN_FONTS.body }}>
                Không tìm thấy sân phù hợp hoặc sân đã có chủ.
              </Text>
            </View>
          )}
        />
      )}
    </View>
  )
}
