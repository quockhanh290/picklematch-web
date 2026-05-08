import { AppDialog, type AppDialogConfig } from '@/components/design'
import DevOwnerLoginSection from '@/components/auth/DevOwnerLoginSection'
import { supabase } from '@/lib/supabase'
import { router } from 'expo-router'
import { Smartphone, ShieldCheck, Landmark } from 'lucide-react-native'
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
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
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

export default function OwnerLoginScreen() {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const isWeb = Platform.OS === 'web'
  const isE2E = process.env.EXPO_PUBLIC_E2E === '1'
  const showDevOnlyUi = __DEV__ || isE2E
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)

  async function sendOTP() {
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
      const formattedPhone = '+84' + phone.replace(/\D/g, '').replace(/^0/, '')
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
      const formattedPhone = '+84' + phone.replace(/\D/g, '').replace(/^0/, '')
      const { error } = await supabase.auth.verifyOtp({
        phone: formattedPhone,
        token: otp,
        type: 'sms',
      })
      if (error) throw error

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser()

      if (userErr || !user?.id) {
        throw new Error(userErr?.message || 'Không lấy được thông tin tài khoản sau khi xác thực OTP.')
      }

      const { data: owner } = await supabase.from('owners').select('id').eq('id', user.id).maybeSingle()

      if (owner) {
        const { data: court } = await supabase.from('courts').select('id').eq('owner_id', user.id).maybeSingle()
        if (court) router.replace('/owner/dashboard')
        else router.replace('/owner/claim-court')
      } else {
        router.replace('/owner/claim-court')
      }
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
            <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 48, color: 'white', lineHeight: 52, letterSpacing: -2 }}>
              OWNER
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.headlineItalic, fontSize: 32, color: 'white', lineHeight: 34, letterSpacing: -1, marginTop: -2, opacity: 0.9 }}>
              DASHBOARD
            </Text>
          </View>
          
          <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.sm, alignSelf: 'flex-start', marginBottom: 16 }}>
            <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.cta, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
              Dành riêng cho chủ sân
            </Text>
          </View>

          <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: SCREEN_FONTS.body, fontSize: 15, lineHeight: 22, maxWidth: 300 }}>
            Quản lý lịch sân, tổ chức giải đấu và kết nối với cộng đồng người chơi chuyên nghiệp.
          </Text>
        </View>

        <View style={{ paddingHorizontal: 24, marginTop: -40 }}>
          <View style={{ borderRadius: RADIUS.xl, backgroundColor: 'white', padding: 24, borderWidth: BORDER.base, borderColor: theme.outlineVariant, ...SHADOW.md }}>
            <View style={{ flexDirection: 'row', backgroundColor: theme.surfaceContainerLow, borderRadius: RADIUS.lg, padding: 4, marginBottom: 32 }}>
              <TouchableOpacity
                disabled={isWeb}
                onPress={() => router.push('/login')}
                style={{ flex: 1, paddingVertical: 10, alignItems: 'center', opacity: isWeb ? 0.45 : 1 }}
              >
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.onSurfaceVariant }}>
                  {isWeb ? 'NGƯỜI CHƠI (TẠM TẮT WEB)' : 'NGƯỜI CHƠI'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={1} style={{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: 'white', borderRadius: RADIUS.md, ...SHADOW.xs }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.primary }}>CHỦ SÂN</Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginBottom: 24 }}>
              <Text style={{ color: theme.onSurface, fontSize: 24, fontFamily: SCREEN_FONTS.headline, textTransform: 'uppercase' }}>
                {step === 'phone' ? 'ĐĂNG NHẬP CHỦ SÂN' : STRINGS.auth.otp_title}
              </Text>
              <Text style={{ marginTop: 4, color: theme.onSurfaceVariant, fontSize: 14, fontFamily: SCREEN_FONTS.body }}>
                {step === 'phone' ? 'Vui lòng nhập SĐT đã đăng ký quản lý sân' : `${STRINGS.auth.otp_sub} ${formattedPhonePreview}`}
              </Text>
            </View>

            {step === 'phone' ? (
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surfaceAlt, borderRadius: RADIUS.lg, borderWidth: BORDER.base, borderColor: theme.outlineVariant, height: 64, paddingHorizontal: 16 }}>
                  <Smartphone size={20} color={theme.primary} />
                  <Text style={{ marginLeft: 12, marginRight: 12, fontSize: 16, fontFamily: SCREEN_FONTS.headline, color: theme.onSurface }}>+84</Text>
                  <View style={{ width: 1, height: 24, backgroundColor: theme.outlineVariant }} />
                  <TextInput value={phone} onChangeText={setPhone} placeholder={STRINGS.auth.phone_placeholder} placeholderTextColor={theme.outline} keyboardType="phone-pad" maxLength={10} style={{ flex: 1, marginLeft: 12, color: theme.onSurface, fontSize: 16, fontFamily: SCREEN_FONTS.body }} />
                </View>
              </View>
            ) : (
              <View>
                <OTPDots value={otp} />
                <TextInput value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))} autoFocus keyboardType="number-pad" maxLength={6} style={{ height: 1, opacity: 0 }} />
              </View>
            )}

            <TouchableOpacity onPress={primaryAction} disabled={loading} style={{ marginTop: 32, height: 56, borderRadius: RADIUS.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', opacity: loading ? 0.7 : 1 }}>
              <Text style={{ color: 'white', fontSize: 16, fontFamily: SCREEN_FONTS.cta, textTransform: 'uppercase', letterSpacing: 1 }}>
                {loading ? STRINGS.auth.processing : step === 'phone' ? STRINGS.auth.submit_phone : STRINGS.auth.submit_otp}
              </Text>
            </TouchableOpacity>

            {showDevOnlyUi ? (
              <TouchableOpacity 
                onPress={() => router.push('/owner/web-quick-start')} 
                style={{ marginTop: 16, alignSelf: 'center', padding: 8 }}
            >
              <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, fontSize: 14 }}>
                TRẢI NGHIỆM NHANH (KHÔNG CẦN OTP) →
              </Text>
            </TouchableOpacity>

            ) : null}
            <TouchableOpacity onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/'); }} style={{ marginTop: 24, alignSelf: 'center' }}>
              <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.label, fontSize: 13 }}>Quay lại màn hình người chơi</Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginTop: 24, flexDirection: 'row', backgroundColor: theme.secondaryContainer, borderRadius: RADIUS.md, padding: 16, gap: 12 }}>
            <Landmark size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, fontSize: 12, textTransform: 'uppercase' }}>Dành cho đối tác</Text>
              <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.body, fontSize: 12, lineHeight: 18, marginTop: 2, opacity: 0.8 }}>Giải pháp quản lý sân thông minh giúp tối ưu hóa công suất và tăng doanh thu.</Text>
            </View>
          </View>

          {showDevOnlyUi && (
            <View style={{ marginBottom: 40 }}>
              <DevOwnerLoginSection presentDialog={(payload) => setDialogConfig(payload)} />
            </View>
          )}

          <View style={{ marginTop: 40, alignItems: 'center', paddingBottom: 40 }}>
            <View style={{ flexDirection: 'row', gap: 12, opacity: 0.5 }}>
              <Text style={{ color: theme.outline, fontSize: 10, fontFamily: SCREEN_FONTS.label }}>ĐIỀU KHOẢN</Text>
              <Text style={{ color: theme.outline, fontSize: 10, fontFamily: SCREEN_FONTS.label }}>•</Text>
              <Text style={{ color: theme.outline, fontSize: 10, fontFamily: SCREEN_FONTS.label }}>CHÍNH SÁCH</Text>
              <Text style={{ color: theme.outline, fontSize: 10, fontFamily: SCREEN_FONTS.label }}>•</Text>
              <Text style={{ color: theme.outline, fontSize: 10, fontFamily: SCREEN_FONTS.label }}>TRỢ GIÚP</Text>
            </View>
          </View>
        </View>
      </ScrollView>
      <AppDialog visible={Boolean(dialogConfig)} config={dialogConfig} onClose={() => setDialogConfig(null)} />
    </KeyboardAvoidingView>
  )
}


