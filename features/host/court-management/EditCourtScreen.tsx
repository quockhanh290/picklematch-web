import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppDialog, type AppDialogConfig, SecondaryNavbar, AppInput } from '@/components/design'
import { useAppTheme } from '@/lib/theme-context'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/useAuth'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW } from '@/constants/screenLayout'
import { Landmark, MapPin, Clock, Phone, Info } from 'lucide-react-native'

export function EditCourtScreen() {
  const theme = useAppTheme()
  const { userId, isLoading: authLoading } = useAuth()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [courtId, setCourtId] = useState<string | null>(params.id as string || null)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [hoursOpen, setHoursOpen] = useState('06:00')
  const [hoursClose, setHoursClose] = useState('22:00')
  const [subCourtCount, setSubCourtCount] = useState('4')
  
  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)

  useEffect(() => {
    if (authLoading) return
    void loadCourt()
  }, [authLoading, courtId, userId])

  async function loadCourt() {
    setLoading(true)
    if (!userId) {
      router.replace('/login' as any)
      return
    }

    let targetId = courtId
    if (!targetId) {
      // Find the first court owned by this user
      const { data: userCourts } = await supabase
        .from('courts')
        .select('id')
        .eq('owner_id', userId)
        .limit(1)
      
      if (userCourts && userCourts.length > 0) {
        targetId = userCourts[0].id
        setCourtId(targetId)
      } else {
        setLoading(false)
        setDialogConfig({
          title: 'Không tìm thấy sân',
          message: 'Bạn chưa sở hữu sân nào trong hệ thống.',
          actions: [{ label: 'Quay lại', onPress: () => router.back() }]
        })
        return
      }
    }

    const { data, error } = await supabase
      .from('courts')
      .select('*')
      .eq('id', targetId)
      .single()

    if (data) {
      setName(data.name || '')
      setAddress(data.address || '')
      setPhone(data.phone || '')
      setHoursOpen(data.hours_open || '06:00')
      setHoursClose(data.hours_close || '22:00')
      setSubCourtCount(data.sub_court_count?.toString() || '4')
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!name.trim() || !address.trim()) {
      setDialogConfig({
        title: 'Thiếu thông tin',
        message: 'Vui lòng nhập tên và địa chỉ sân.',
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    if (!courtId) return
    setSaving(true)

    const { error } = await supabase
      .from('courts')
      .update({
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        hours_open: hoursOpen,
        hours_close: hoursClose,
        sub_court_count: parseInt(subCourtCount, 10) || 4,
      })
      .eq('id', courtId)

    setSaving(false)
    if (error) {
      setDialogConfig({
        title: 'Lỗi',
        message: error.message,
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    setDialogConfig({
      title: 'Đã lưu',
      message: 'Thông tin sân đã được cập nhật thành công.',
      actions: [{ label: 'Xong', onPress: () => router.back() }]
    })
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
      <SecondaryNavbar title="QUẢN LÝ THÔNG TIN SÂN" onBackPress={() => router.back()} />
      
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 120 }}>
        <View style={{ marginBottom: 32 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 32, color: theme.onBackground, textTransform: 'uppercase', lineHeight: 38, marginBottom: 8 }}>
            THÔNG TIN SÂN BÃI
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 14, color: theme.onSurfaceVariant, lineHeight: 20 }}>
            Cập nhật thông tin chi tiết để người chơi dễ dàng tìm kiếm và đặt lịch tại sân của bạn.
          </Text>
        </View>

        <View style={{ gap: 24 }}>
          <AppInput 
            label="TÊN SÂN" 
            value={name} 
            onChangeText={setName} 
            placeholder="Ví dụ: Sân Pickleball Bình Thạnh" 
            leftIcon={<Landmark size={18} color={theme.outline} />}
          />
          
          <AppInput 
            label="ĐỊA CHỈ" 
            value={address} 
            onChangeText={setAddress} 
            placeholder="Số nhà, tên đường, quận/huyện..." 
            leftIcon={<MapPin size={18} color={theme.outline} />}
            multiline
          />

          <AppInput 
            label="SỐ ĐIỆN THOẠI LIÊN HỆ" 
            value={phone} 
            onChangeText={setPhone} 
            placeholder="Số điện thoại đặt sân" 
            keyboardType="phone-pad"
            leftIcon={<Phone size={18} color={theme.outline} />}
          />

          <View style={{ flexDirection: 'row', gap: 16 }}>
            <View style={{ flex: 1 }}>
              <AppInput 
                label="GIỜ MỞ CỬA" 
                value={hoursOpen} 
                onChangeText={setHoursOpen} 
                placeholder="06:00" 
                leftIcon={<Clock size={18} color={theme.outline} />}
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppInput 
                label="GIỜ ĐÓNG CỬA" 
                value={hoursClose} 
                onChangeText={setHoursClose} 
                placeholder="22:00" 
                leftIcon={<Clock size={18} color={theme.outline} />}
              />
            </View>
          </View>

          <View style={{ 
            backgroundColor: theme.surfaceContainerLow, 
            padding: 24, 
            borderRadius: RADIUS.xl,
            borderWidth: 1,
            borderColor: theme.outlineVariant,
            marginTop: 8
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
            
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  TỔNG SỐ SÂN CON
                </Text>
                <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSurfaceVariant }}>
                  Số lượng trận đấu có thể diễn ra cùng lúc.
                </Text>
              </View>

              <View style={{ 
                backgroundColor: theme.surfaceAlt,
                borderRadius: RADIUS.lg,
                borderWidth: 2,
                borderColor: theme.primary,
                width: 80,
                height: 56,
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <TextInput
                  value={subCourtCount}
                  onChangeText={setSubCourtCount}
                  keyboardType="number-pad"
                  style={{
                    color: theme.primary,
                    fontSize: 24,
                    fontFamily: SCREEN_FONTS.headline,
                    textAlign: 'center',
                    width: '100%'
                  }}
                />
              </View>
            </View>
          </View>
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
            {saving ? 'ĐANG LƯU...' : 'CẬP NHẬT THÔNG TIN SÂN'}
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
