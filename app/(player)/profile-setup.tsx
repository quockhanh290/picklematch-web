import { AppButton, AppDialog, type AppDialogConfig, AppInput, SecondaryNavbar, SectionCard } from '@/components/design'
import { useAppTheme } from '@/lib/theme-context'
import { getEloBandByLegacySkillLabel } from '@/lib/eloSystem'
import { SCREEN_FONTS } from '@/constants/typography'
import { supabase } from '@/lib/supabase'
import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, Text, TouchableOpacity, View } from 'react-native'

export default function ProfileSetup() {
  const theme = useAppTheme()
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [bio, setBio] = useState('')
  const [loading, setLoading] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)
  const defaultBand = getEloBandByLegacySkillLabel('beginner')

  async function saveProfile() {
    if (!name || !city) {
      setDialogConfig({
        title: 'Thiếu thông tin',
        message: 'Vui lòng điền tên và thành phố của bạn.',
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    setLoading(true)

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setLoading(false)
      setDialogConfig({
        title: 'Lỗi',
        message: userError?.message ?? 'Không tìm thấy tài khoản hiện tại.',
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    const { error } = await supabase.from('players').upsert({
      id: user.id,
      phone: user.phone || null,
      name,
      city,
      bio,
      skill_label: defaultBand.legacySkillLabel,
      skill_tier: defaultBand.tier,
      elo: defaultBand.seedElo,
      current_elo: defaultBand.seedElo,
    })

    setLoading(false)

    if (error) {
      setDialogConfig({
        title: 'Lỗi',
        message: error.message,
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    router.replace('/onboarding')
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar 
        title="THIẾT LẬP HỒ SƠ" 
        onBackPress={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/login')
        }} 
      />
      <ScrollView 
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 32, paddingBottom: 24 }}>
          <Text style={{ 
            color: theme.primary, 
            fontFamily: SCREEN_FONTS.cta, 
            fontSize: 11, 
            letterSpacing: 2, 
            textTransform: 'uppercase',
            marginBottom: 8 
          }}>
            Bước 1: Cơ bản
          </Text>
          <Text style={{ 
            color: theme.onSurface, 
            fontFamily: SCREEN_FONTS.headline, 
            fontSize: 32, 
            lineHeight: 38,
            marginBottom: 12 
          }}>
            TẠO HỒ SƠ CỦA BẠN
          </Text>
          <Text style={{ 
            color: theme.onSurfaceVariant, 
            fontFamily: SCREEN_FONTS.body, 
            fontSize: 15, 
            lineHeight: 24 
          }}>
            Hãy cho cộng đồng biết bạn là ai. Thông tin này giúp chúng mình gợi ý những kèo đấu phù hợp nhất với bạn.
          </Text>
        </View>

        <View style={{ px: 20, gap: 20, paddingHorizontal: 20 }}>
          <SectionCard 
            title="Thông tin định danh" 
            subtitle="Tên và thành phố giúp mọi người nhận ra bạn trên sân."
          >
            <View style={{ gap: 20, marginTop: 8 }}>
              <AppInput
                label="Tên / Nickname"
                placeholder="Ví dụ: Minh Pickle"
                value={name}
                onChangeText={setName}
              />
              <AppInput
                label="Bạn ở thành phố nào?"
                placeholder="TP. Hồ Chí Minh"
                value={city}
                onChangeText={setCity}
              />

              <View style={{ marginTop: 8 }}>
                <Text style={{ 
                  fontFamily: SCREEN_FONTS.label, 
                  fontSize: 13, 
                  color: theme.onSurface,
                  marginBottom: 12
                }}>
                  Giới tính
                </Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  {[
                    { id: 'nam', label: 'Nam', icon: '♂' },
                    { id: 'nu', label: 'Nữ', icon: '♀' }
                  ].map(opt => (
                    <TouchableOpacity
                      key={opt.id}
                      activeOpacity={0.8}
                      onPress={() => setGender(opt.id as any)}
                      style={{
                        flex: 1,
                        height: 54,
                        borderRadius: RADIUS.md,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        backgroundColor: gender === opt.id ? theme.primary : theme.surfaceAlt,
                        borderWidth: 1.5,
                        borderColor: gender === opt.id ? theme.primary : 'transparent',
                      }}
                    >
                      <Text style={{ fontSize: 18 }}>{opt.icon}</Text>
                      <Text style={{ 
                        color: gender === opt.id ? theme.onPrimary : theme.onSurface,
                        fontFamily: SCREEN_FONTS.label,
                        fontSize: 15
                      }}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </SectionCard>

          <SectionCard 
            title="Giới thiệu một chút" 
            subtitle="Phong cách chơi hoặc mục tiêu của bạn."
          >
            <View style={{ marginTop: 8 }}>
              <AppInput
                label="Mô tả bản thân"
                placeholder="Ví dụ: Đam mê Pickleball với lối chơi năng lượng..."
                value={bio}
                onChangeText={setBio}
                multiline
                numberOfLines={3}
              />
            </View>
          </SectionCard>

          <View style={{ marginTop: 12 }}>
            <AppButton 
              label="Tiếp tục" 
              onPress={saveProfile} 
              loading={loading} 
            />
          </View>

          <TouchableOpacity 
            activeOpacity={0.7} 
            style={{ marginTop: 16, alignItems: 'center', paddingVertical: 12 }} 
            onPress={() => {
              if (router.canGoBack()) router.back()
              else router.replace('/login')
            }}
          >
            <Text style={{ 
              color: theme.outline, 
              fontFamily: SCREEN_FONTS.label, 
              fontSize: 14,
              textDecorationLine: 'underline' 
            }}>
              Quay lại đăng nhập
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <AppDialog
        visible={Boolean(dialogConfig)}
        config={dialogConfig}
        onClose={() => setDialogConfig(null)}
      />
    </View>
  )
}

