import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppDialog, type AppDialogConfig, SecondaryNavbar, AppInput } from '@/components/design'
import { useAppTheme } from '@/lib/theme-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'

export function OwnerEditProfileScreen() {
  const theme = useAppTheme()
  const { userId } = useAuth()
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [bio, setBio] = useState('')
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)

  useEffect(() => {
    void loadProfile()
  }, [userId])

  async function loadProfile() {
    if (!userId) {
      router.replace('/owner/login')
      return
    }

    const { data, error } = await supabase
      .from('players') // Currently owners are stored in the same players table but with different fields used
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (data) {
      setName(data.name || '')
      setPhone(data.phone || '')
      setBio(data.bio || '')
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!name.trim()) {
      setDialogConfig({
        title: 'Lỗi',
        message: 'Tên không được để trống',
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    if (!userId) return
    setSaving(true)

    const { error } = await supabase
      .from('players')
      .update({
        name: name.trim(),
        phone: phone.trim(),
        bio: bio.trim(),
      })
      .eq('id', userId)

    setSaving(false)
    if (error) {
      setDialogConfig({
        title: 'Lỗi',
        message: error.message,
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    router.back()
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.primary} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar title="CHỈNH SỬA HỒ SƠ CHỦ SÂN" onBackPress={() => router.back()} />
      
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 100 }}>
        <View style={{ marginBottom: 32 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 32, color: theme.onBackground, textTransform: 'uppercase', lineHeight: 38, marginBottom: 8 }}>
            THÔNG TIN CÁ NHÂN
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.onSurfaceVariant, lineHeight: 20 }}>
            Thông tin này sẽ được hiển thị cho người chơi khi họ xem thông tin sân của bạn.
          </Text>
        </View>

        <View style={{ gap: 24 }}>
          <AppInput 
            label="HỌ VÀ TÊN" 
            value={name} 
            onChangeText={setName} 
            placeholder="Nhập tên của bạn" 
          />
          
          <AppInput 
            label="SỐ ĐIỆN THOẠI" 
            value={phone} 
            onChangeText={setPhone} 
            placeholder="Số điện thoại liên hệ" 
            keyboardType="phone-pad"
          />

          <AppInput 
            label="MÔ TẢ NGẮN (BIO)" 
            value={bio} 
            onChangeText={setBio} 
            placeholder="Giới thiệu về bạn hoặc sân của bạn..." 
            multiline
            numberOfLines={4}
          />
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
      }}>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={{
            height: 56,
            backgroundColor: theme.primary,
            borderRadius: RADIUS.full,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: saving ? 0.7 : 1
          }}
        >
          <Text style={{ color: 'white', fontFamily: SCREEN_FONTS.headline, fontSize: 15, textTransform: 'uppercase', letterSpacing: 1 }}>
            {saving ? 'ĐANG LƯU...' : 'LƯU THAY ĐỔI'}
          </Text>
        </TouchableOpacity>
      </View>

      <AppDialog
        visible={Boolean(dialogConfig)}
        config={dialogConfig}
        onClose={() => setDialogConfig(null)}
      />
    </View>
  )
}
