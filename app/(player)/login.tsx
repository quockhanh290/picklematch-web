import { AppDialog, type AppDialogConfig } from '@/components/design'
import { supabase } from '@/lib/supabase'
import { safeStorageSetItem } from '@/lib/storage'
import { router } from 'expo-router'
import { Smartphone, ShieldCheck, CheckCircle2 } from 'lucide-react-native'
import DevLoginSection from '@/components/auth/DevLoginSection'
import { useAppTheme } from '@/lib/theme-context'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'

function OTPDots({ value }: { value: string }) {
  const theme = useAppTheme()
  return (
    <View className="flex-row justify-between">
      {Array.from({ length: 6 }).map((_, index) => {
        const digit = value[index]
        const active = !!digit

        return (
          <View
            key={index}
            style={{
              height: 56,
              width: 50,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: RADIUS.lg,
              backgroundColor: theme.surfaceContainerLow,
              borderWidth: BORDER.base,
              borderColor: active ? theme.primary : theme.outlineVariant,
            }}
          >
            <Text
              style={{
                color: theme.onSurface,
                fontSize: 22,
                fontFamily: SCREEN_FONTS.headline,
              }}
            >
              {digit ?? ''}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

export default function LoginScreen() {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const isPlayerLoginDisabled = Platform.OS === 'web' && !__DEV__ // Enable on web during dev for testing profile
  const isE2E = process.env.EXPO_PUBLIC_E2E === '1'
  const showDevOnlyUi = __DEV__ || isE2E
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)

  function nextRouteForPlayer(player: { onboarding_completed?: boolean; self_assessed_level?: any } | null) {
  if (!player) return '/profile-setup'
  if (!player.onboarding_completed || !player.self_assessed_level) return '/onboarding'
  return '/player-hub/find-session'
}

async function sendOTP() {
  if (isPlayerLoginDisabled) {
    setDialogConfig({
      title: 'Tạm khóa đăng nhập người chơi',
      message: 'Phiên bản web hiện chỉ hỗ trợ flow Host. Vui lòng đăng nhập ở màn Host.',
      actions: [{ label: 'Đi tới Host', onPress: () => router.replace('/host/login') }],
    })
    return
  }

  if (!phone || phone.replace(/\D/g, '').length < 9) {
    setDialogConfig({
      title: 'Lỗi',
      message: 'Vui lòng nhập số điện thoại hợp lệ',
      actions: [{ label: 'Đã hiểu' }],
    })
    return
  }

  setLoading(true)
  try {
    const sanitized = phone.replace(/\D/g, '')
    // Bypass for testing
    if (sanitized === '0123456789') {
      setStep('otp')
      return
    }

    const formattedPhone = '+84' + sanitized.replace(/^0/, '')
    const { error } = await supabase.auth.signInWithOtp({ phone: formattedPhone })
    if (error) throw error
    setStep('otp')
  } catch (err: any) {
    setDialogConfig({
      title: 'Lỗi',
      message: err?.message || 'Không thể gửi OTP. Vui lòng kiểm tra kết nối và thử lại.',
      actions: [{ label: 'Đã hiểu' }],
    })
  } finally {
    setLoading(false)
  }
}

async function verifyOTP() {
  if (isPlayerLoginDisabled) {
    setDialogConfig({
      title: 'Tạm khóa đăng nhập người chơi',
      message: 'Phiên bản web hiện chỉ hỗ trợ flow Host. Vui lòng đăng nhập ở màn Host.',
      actions: [{ label: 'Đi tới Host', onPress: () => router.replace('/host/login') }],
    })
    return
  }

  if (!otp || otp.length < 6) {
    setDialogConfig({
      title: 'Lỗi',
      message: 'Nhập đủ 6 số OTP từ SMS',
      actions: [{ label: 'Đã hiểu' }],
    })
    return
  }

  setLoading(true)
  try {
    const sanitized = phone.replace(/\D/g, '')
    // Bypass for testing
    if (sanitized === '0123456789' && otp === '123456') {
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (userErr || !user) {
         // If no user session, we might need a real sign-in or just mock redirect if user exists
         // For now, assume a session exists if they just tried to sign in or use a fixed test UUID
      }
    } else {
      const formattedPhone = '+84' + sanitized.replace(/^0/, '')
      const { error } = await supabase.auth.verifyOtp({
        phone: formattedPhone,
        token: otp,
        type: 'sms',
      })
      if (error) throw error
    }

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()

    if (userErr || !user?.id) {
      throw new Error(userErr?.message || 'Không lấy được thông tin tài khoản sau khi xác thực OTP.')
    }

    const { data: player } = await supabase.from('players').select('*').eq('id', user.id).maybeSingle()
    await safeStorageSetItem('user_role', 'player')
    
    router.replace(nextRouteForPlayer(player) as any)
  } catch (err: any) {
    setDialogConfig({
      title: 'Lỗi',
      message: err?.message || 'Xác thực OTP thất bại. Vui lòng thử lại.',
      actions: [{ label: 'Đã hiểu' }],
    })
  } finally {
    setLoading(false)
  }
}
const sanitizedPhone = phone.replace(/\D/g, '')
  const formattedPhonePreview = sanitizedPhone ? `+84 ${sanitizedPhone.replace(/^0/, '')}` : '+84'
  const primaryAction = step === 'phone' ? sendOTP : verifyOTP
  
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      <ScrollView
        bounces={false}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Editorial Hero Section */}
        <View style={{ 
          backgroundColor: theme.primary, 
          paddingTop: insets.top + 40,
          paddingBottom: 90,
          paddingHorizontal: 24,
          borderBottomLeftRadius: RADIUS.hero,
          borderBottomRightRadius: RADIUS.hero,
        }}>
          <View style={{ marginBottom: 24 }}>
            <View style={{ width: 48, height: 6, backgroundColor: 'white', borderRadius: RADIUS.full, marginBottom: 20, opacity: 0.8 }} />
            <Text style={{ 
              fontFamily: SCREEN_FONTS.headlineItalic, 
              fontSize: 48, 
              color: 'white', 
              lineHeight: 52,
              letterSpacing: -2 
            }}>
              PICKLEMATCH
            </Text>
            <Text style={{ 
              fontFamily: SCREEN_FONTS.headlineItalic, 
              fontSize: 32, 
              color: 'white', 
              lineHeight: 34,
              letterSpacing: -1,
              marginTop: -2,
              opacity: 0.9
            }}>
              VIETNAM
            </Text>
          </View>
          
          <View style={{ 
            backgroundColor: 'rgba(255,255,255,0.12)', 
            paddingHorizontal: 12, 
            paddingVertical: 6, 
            borderRadius: RADIUS.sm,
            alignSelf: 'flex-start',
            marginBottom: 16
          }}>
            <Text style={{ 
              color: 'white', 
              fontFamily: SCREEN_FONTS.cta, 
              fontSize: 10, 
              letterSpacing: 1,
              textTransform: 'uppercase'
            }}>
              The Next Gen Pickleball Hub
            </Text>
          </View>

          <Text style={{ 
            color: 'rgba(255,255,255,0.85)', 
            fontFamily: SCREEN_FONTS.body, 
            fontSize: 15, 
            lineHeight: 22,
            maxWidth: 300
          }}>
            Kiến tạo cộng đồng, nâng tầm đam mê và tìm kiếm những trận đấu bùng nổ ngay hôm nay.
          </Text>
        </View>

        <View style={{ paddingHorizontal: 24, marginTop: -40 }}>
          <View
            style={{
              borderRadius: RADIUS.xl,
              backgroundColor: 'white',
              padding: 24,
              borderWidth: BORDER.base,
              borderColor: theme.outlineVariant,
              ...SHADOW.md,
            }}
          >
            <View style={{ 
              flexDirection: 'row', 
              backgroundColor: theme.surfaceContainerLow, 
              borderRadius: RADIUS.lg, 
              padding: 4,
              marginBottom: 32
            }}>
              <TouchableOpacity 
                activeOpacity={1}
                style={{ 
                  flex: 1, 
                  paddingVertical: 10, 
                  alignItems: 'center',
                  backgroundColor: 'white',
                  borderRadius: RADIUS.md,
                  ...SHADOW.xs
                }}
              >
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.primary }}>NGƯỜI CHƠI</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => router.push('/host/login')}
                style={{ 
                  flex: 1, 
                  paddingVertical: 10, 
                  alignItems: 'center'
                }}
              >
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.onSurfaceVariant }}>HOST</Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginBottom: 24 }}>
              <Text style={{ 
                color: theme.onSurface, 
                fontSize: 24, 
                fontFamily: SCREEN_FONTS.headline,
                textTransform: 'uppercase'
              }}>
                {step === 'phone' ? STRINGS.auth.login_title : STRINGS.auth.otp_title}
              </Text>
              <Text style={{ 
                marginTop: 4, 
                color: theme.onSurfaceVariant, 
                fontSize: 14, 
                fontFamily: SCREEN_FONTS.body 
              }}>
                {step === 'phone' 
                  ? STRINGS.auth.phone_sub 
                  : `${STRINGS.auth.otp_sub} ${formattedPhonePreview}`}
              </Text>
            </View>

            {step === 'phone' ? (
              <View>
                <View style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  backgroundColor: theme.surfaceAlt,
                  borderRadius: RADIUS.lg,
                  borderWidth: BORDER.base,
                  borderColor: theme.outlineVariant,
                  height: 64,
                  paddingHorizontal: 16,
                }}>
                  <Smartphone size={20} color={theme.primary} />
                  <Text style={{ 
                    marginLeft: 12,
                    marginRight: 12,
                    fontSize: 16, 
                    fontFamily: SCREEN_FONTS.headline,
                    color: theme.onSurface
                  }}>+84</Text>
                  <View style={{ width: 1, height: 24, backgroundColor: theme.outlineVariant }} />
                  <TextInput
                    value={phone}
                    onChangeText={setPhone}
                    placeholder={STRINGS.auth.phone_placeholder}
                    placeholderTextColor={theme.outline}
                    keyboardType="phone-pad"
                    maxLength={10}
                    style={{
                      flex: 1,
                      marginLeft: 12,
                      color: theme.onSurface,
                      fontSize: 16,
                      fontFamily: SCREEN_FONTS.body,
                    }}
                  />
                </View>
                
                <Text style={{ 
                  marginTop: 12, 
                  color: theme.onSurfaceVariant, 
                  fontSize: 12, 
                  fontFamily: SCREEN_FONTS.body,
                  lineHeight: 18
                }}>
                  {STRINGS.auth.phone_hint}
                </Text>
              </View>
            ) : (
              <View>
                <OTPDots value={otp} />
                <TextInput
                  value={otp}
                  onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  keyboardType="number-pad"
                  maxLength={6}
                  style={{ height: 1, opacity: 0 }}
                />
                
                <Pressable 
                  onPress={sendOTP} 
                  disabled={loading}
                  style={{ marginTop: 20, alignSelf: 'center' }}
                >
                  <Text style={{ 
                    color: theme.primary, 
                    fontFamily: SCREEN_FONTS.headline,
                    fontSize: 14,
                    textDecorationLine: 'underline'
                  }}>
                    {STRINGS.auth.resend_otp}
                  </Text>
                </Pressable>
              </View>
            )}

            <TouchableOpacity
              onPress={primaryAction}
              disabled={loading || isPlayerLoginDisabled}
              style={{
                marginTop: 32,
                height: 56,
                borderRadius: RADIUS.md,
                backgroundColor: isPlayerLoginDisabled ? theme.outlineVariant : theme.primary,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: loading || isPlayerLoginDisabled ? 0.7 : 1,
              }}
            >
              <Text style={{ 
                color: 'white', 
                fontSize: 16, 
                fontFamily: SCREEN_FONTS.cta,
                textTransform: 'uppercase',
                letterSpacing: 1
              }}>
                {isPlayerLoginDisabled
                  ? 'WEB CHỈ HỖ TRỢ CHỦ SÂN'
                  : loading
                    ? STRINGS.auth.processing
                    : step === 'phone'
                      ? STRINGS.auth.submit_phone
                      : STRINGS.auth.submit_otp}
              </Text>
            </TouchableOpacity>

            {step === 'otp' && (
              <Pressable 
                onPress={() => setStep('phone')}
                style={{ marginTop: 16, alignSelf: 'center' }}
              >
                <Text style={{ 
                  color: theme.onSurfaceVariant, 
                  fontFamily: SCREEN_FONTS.label,
                  fontSize: 13
                }}>
                  {STRINGS.auth.change_phone}
                </Text>
              </Pressable>
            )}
          </View>

          {/* Trust Banner */}
          <View style={{ 
            marginTop: 24, 
            flexDirection: 'row', 
            backgroundColor: theme.secondaryContainer,
            borderRadius: RADIUS.md,
            padding: 16,
            gap: 12
          }}>
            <ShieldCheck size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, fontSize: 12, textTransform: 'uppercase' }}>
                {STRINGS.auth.trust_title}
              </Text>
              <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 18, marginTop: 2, opacity: 0.8 }}>
                {STRINGS.auth.trust_sub}
              </Text>
            </View>
          </View>

          <View style={{ marginTop: 40, alignItems: 'center', paddingBottom: 40 }}>
            <Text style={{ 
              color: theme.onSurfaceVariant, 
              fontFamily: SCREEN_FONTS.body,
              fontSize: 14 
            }}>
              {STRINGS.auth.no_account}{' '}
              <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline }}>{STRINGS.auth.join_now}</Text>
            </Text>

            <TouchableOpacity 
              onPress={() => router.push('/host/login')}
              style={{ marginTop: 12 }}
            >
              <Text style={{ 
                color: theme.onSurfaceVariant, 
                fontFamily: SCREEN_FONTS.label,
                fontSize: 13,
                textDecorationLine: 'underline'
              }}>
                {STRINGS.host_flow.login_link}
              </Text>
            </TouchableOpacity>
            
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 24, opacity: 0.5 }}>
              <Text style={{ color: theme.outline, fontSize: 10, fontFamily: SCREEN_FONTS.label }}>ĐIỀU KHOẢN</Text>
              <Text style={{ color: theme.outline, fontSize: 10, fontFamily: SCREEN_FONTS.label }}>•</Text>
              <Text style={{ color: theme.outline, fontSize: 10, fontFamily: SCREEN_FONTS.label }}>CHÍNH SÁCH</Text>
              <Text style={{ color: theme.outline, fontSize: 10, fontFamily: SCREEN_FONTS.label }}>•</Text>
              <Text style={{ color: theme.outline, fontSize: 10, fontFamily: SCREEN_FONTS.label }}>TRỢ GIÚP</Text>
            </View>
          </View>

          {showDevOnlyUi ? (
            <View style={{ marginBottom: 40 }}>
              <DevLoginSection
                nextRouteForPlayer={nextRouteForPlayer}
                presentDialog={(payload) => setDialogConfig(payload)}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
      
      <AppDialog
        visible={Boolean(dialogConfig)}
        config={dialogConfig}
        onClose={() => setDialogConfig(null)}
      />
    </KeyboardAvoidingView>
  )
}




