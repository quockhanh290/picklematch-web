import { AppDialogConfig } from '@/components/design'
import { supabase } from '@/lib/supabase'
import { router } from 'expo-router'
import { useAppTheme } from '@/lib/theme-context'
import { ShieldCheck, Lock, Mail } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { SPACING, RADIUS } from '@/constants/screenLayout'

export default function DevHostLoginSection({
  presentDialog,
}: {
  presentDialog?: (config: AppDialogConfig) => void
}) {
  const theme = useAppTheme()
  const [devEmail, setDevEmail] = useState('')
  const [devPassword, setDevPassword] = useState('')
  const [devLoading, setDevLoading] = useState(false)

  const DEV = {
    emerald: theme.surfaceTint,
    emeraldDark: theme.primaryContainer,
    ink: theme.onSurface,
    skySoft: theme.secondaryContainer,
    panel: theme.surfaceContainer,
    textMuted: theme.onSurfaceVariant,
    white: theme.onPrimary,
  } as const

  async function devSignIn() {
    if (!devEmail || !devPassword) {
      presentDialog?.({
        title: 'Lỗi đăng nhập dev',
        message: 'Nhập email và mật khẩu để tiếp tục.',
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    setDevLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: devEmail,
      password: devPassword,
    })

    if (error) {
      setDevLoading(false)
      presentDialog?.({
        title: 'Lỗi đăng nhập dev',
        message: error.message,
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setDevLoading(false)
      return
    }

    // Ensure player is marked as host for dev convenience (upsert to handle new users)
    await supabase.from('players').upsert({ 
      id: user.id, 
      is_host: true,
      name: user.email?.split('@')[0] || 'Dev Host' 
    }).eq('id', user.id)
    
    // Set role in storage so AuthGate knows where to go
    const { safeStorageSetItem } = await import('@/lib/storage')
    await safeStorageSetItem('user_role', 'host')

    setDevLoading(false)
    router.replace('/host/dashboard')
  }

  return (
    <View
      style={{
        borderRadius: RADIUS.hero,
        backgroundColor: DEV.panel,
        padding: SPACING.lg,
        marginTop: 40
      }}
    >
      <View style={{ marginBottom: 16, flexDirection: 'row', alignItems: 'flex-start' }}>
        <View
          style={{
            marginRight: 12,
            height: 48,
            width: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            backgroundColor: theme.secondaryFixed,
          }}
        >
          <ShieldCheck size={20} color={DEV.emeraldDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: DEV.ink, fontSize: 16, fontFamily: SCREEN_FONTS.cta }}>HOST DEV MODE</Text>
          <Text
            style={{
              marginTop: 4,
              color: DEV.textMuted,
              fontSize: 13,
              lineHeight: 21,
              fontFamily: SCREEN_FONTS.body,
            }}
          >
            Chế độ dành cho phát triển: Đăng nhập nhanh chủ sân bằng Email/Mật khẩu.
          </Text>
        </View>
      </View>

      <View style={{ gap: 16 }}>
        <View>
          <Text style={{ marginBottom: 10, color: DEV.textMuted, fontSize: 12, letterSpacing: 0.8, fontFamily: SCREEN_FONTS.cta }}>
            EMAIL CHỦ SÂN
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 24, paddingHorizontal: 16, height: 56, backgroundColor: DEV.skySoft }}>
            <View style={{ marginRight: 12, height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.4)' }}>
              <Mail size={18} color={DEV.emeraldDark} />
            </View>
            <TextInput
              testID="dev-owner-email-input"
              value={devEmail}
              onChangeText={setDevEmail}
              placeholder="Nhập email dev"
              placeholderTextColor={theme.outline}
              autoCapitalize="none"
              keyboardType="email-address"
              style={{ flex: 1, color: DEV.ink, fontSize: 15, fontFamily: SCREEN_FONTS.body }}
            />
          </View>
        </View>

        <View>
          <Text style={{ marginBottom: 10, color: DEV.textMuted, fontSize: 12, letterSpacing: 0.8, fontFamily: SCREEN_FONTS.cta }}>
            MẬT KHẨU DEV
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 24, paddingHorizontal: 16, height: 56, backgroundColor: DEV.skySoft }}>
            <View style={{ marginRight: 12, height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.4)' }}>
              <Lock size={18} color={DEV.emeraldDark} />
            </View>
            <TextInput
              testID="dev-owner-password-input"
              value={devPassword}
              onChangeText={setDevPassword}
              placeholder="Nhập mật khẩu dev"
              placeholderTextColor={theme.outline}
              secureTextEntry
              style={{ flex: 1, color: DEV.ink, fontSize: 15, fontFamily: SCREEN_FONTS.body }}
            />
          </View>
        </View>

        <Pressable
          testID="dev-owner-login-submit"
          onPress={devSignIn}
          disabled={devLoading}
          style={{
            marginTop: 6,
            height: 56,
            borderRadius: RADIUS.hero,
            backgroundColor: DEV.emerald,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: devLoading ? 0.72 : 1,
            shadowColor: theme.surfaceTint,
            shadowOpacity: 0.22,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 8 },
            elevation: 5,
          }}
        >
          <Text style={{ color: DEV.white, fontSize: 15, fontFamily: SCREEN_FONTS.cta }}>
            {devLoading ? 'ĐANG ĐĂNG NHẬP...' : 'ĐĂNG NHẬP NHANH'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}
