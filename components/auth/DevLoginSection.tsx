import { AppDialogConfig } from '@/components/design'
import { supabase } from '@/lib/supabase'
import { router } from 'expo-router'
import { useAppTheme } from '@/lib/theme-context'
import { Code2, Lock, Mail } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { SPACING, RADIUS } from '@/constants/screenLayout'

export default function DevLoginSection({
  nextRouteForPlayer,
  presentDialog,
}: {
  nextRouteForPlayer: (player: any) => string
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
    setDevLoading(false)

    if (error) {
      presentDialog?.({
        title: 'Lỗi đăng nhập dev',
        message: error.message,
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.id) {
      presentDialog?.({
        title: 'Lỗi',
        message: 'Không lấy được thông tin tài khoản sau khi đăng nhập dev.',
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    const { data: player } = await supabase.from('players').select('*').eq('id', user.id).single()
    router.replace(nextRouteForPlayer(player) as any)
  }

  return (
    <View
      style={{
        borderRadius: RADIUS.hero,
        backgroundColor: DEV.panel,
        padding: SPACING.lg,
      }}
    >
      <View className="mb-4 flex-row items-start">
        <View
          className="mr-3 h-12 w-12 items-center justify-center rounded-full"
          style={{ backgroundColor: theme.secondaryFixed }}
        >
          <Code2 size={20} color={DEV.emeraldDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: DEV.ink, fontSize: 16, fontFamily: SCREEN_FONTS.cta }}>Chỉ dành cho phát triển</Text>
          <Text
            style={{
              marginTop: 4,
              color: DEV.textMuted,
              fontSize: 13,
              lineHeight: 21,
              fontFamily: SCREEN_FONTS.body,
            }}
          >
            Đăng nhập nhanh bằng email và mật khẩu để kiểm tra luồng nội bộ trong môi trường development.
          </Text>
        </View>
      </View>

      <View className="gap-4">
        <View>
          <Text
            style={{
              marginBottom: 10,
              color: DEV.textMuted,
              fontSize: 12,
              letterSpacing: 0.8,
              fontFamily: SCREEN_FONTS.cta,
            }}
          >
            EMAIL DEV
          </Text>
          <View
            className="flex-row items-center rounded-[24px] px-4"
            style={{
              height: 56,
              backgroundColor: DEV.skySoft,
            }}
          >
            <View
              className="mr-3 h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: 'rgba(255,255,255,0.4)' }}
            >
              <Mail size={18} color={DEV.emeraldDark} />
            </View>
            <TextInput
              testID="dev-player-email-input"
              value={devEmail}
              onChangeText={setDevEmail}
              placeholder="Nhập email dev"
              placeholderTextColor={theme.outline}
              autoCapitalize="none"
              keyboardType="email-address"
              style={{
                flex: 1,
                color: DEV.ink,
                fontSize: 15,
                fontFamily: SCREEN_FONTS.body,
              }}
            />
          </View>
        </View>

        <View>
          <Text
            style={{
              marginBottom: 10,
              color: DEV.textMuted,
              fontSize: 12,
              letterSpacing: 0.8,
              fontFamily: SCREEN_FONTS.cta,
            }}
          >
            MẬT KHẨU DEV
          </Text>
          <View
            className="flex-row items-center rounded-[24px] px-4"
            style={{
              height: 56,
              backgroundColor: DEV.skySoft,
            }}
          >
            <View
              className="mr-3 h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: 'rgba(255,255,255,0.4)' }}
            >
              <Lock size={18} color={DEV.emeraldDark} />
            </View>
            <TextInput
              testID="dev-player-password-input"
              value={devPassword}
              onChangeText={setDevPassword}
              placeholder="Nhập mật khẩu dev"
              placeholderTextColor={theme.outline}
              secureTextEntry
              style={{
                flex: 1,
                color: DEV.ink,
                fontSize: 15,
                fontFamily: SCREEN_FONTS.body,
              }}
            />
          </View>
        </View>

        <Pressable
          testID="dev-player-login-submit"
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
            {devLoading ? 'Đang đăng nhập...' : 'Đăng nhập nhanh'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}



