import React, { useState, useEffect, useMemo } from 'react'
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  FlatList,
  Alert,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { 
  Search, 
  MapPin, 
  ChevronRight, 
  CheckCircle2, 
  Landmark, 
  Plus, 
  Share2,
  Settings
} from 'lucide-react-native'
import * as Linking from 'expo-linking'

import { AppButton, AppInput, AppLoading, SecondaryNavbar, AppChip } from '@/components/design'
import { useAppTheme } from '@/lib/theme-context'
import { supabase } from '@/lib/supabase'
import { SCREEN_FONTS, AppFontSet } from '@/constants/typography'
import { RADIUS, SPACING, SHADOW, BORDER } from '@/constants/screenLayout'

type Step = 'search' | 'info' | 'config' | 'create' | 'finish'

export default function HostWebQuickStart() {
  const { step, courtId } = useLocalSearchParams<{ step?: string, courtId?: string }>()
  const theme = useAppTheme()
  const isE2E = process.env.EXPO_PUBLIC_E2E === '1'
  const [currentStep, setCurrentStep] = useState<Step>((step as Step) || 'search')
  const [loading, setLoading] = useState(false)

  // Data State
  const [search, setSearch] = useState('')
  const [courts, setCourts] = useState<any[]>([])
  const [selectedCourt, setSelectedCourt] = useState<any>(null)
  
  // Form State
  const [businessName, setBusinessName] = useState('')
  const [phone, setPhone] = useState('')
  const [subCourtCount, setSubCourtCount] = useState('1')
  
  // Session State
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('20:00')
  const [format, setFormat] = useState('social')
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null)

  useEffect(() => {
    if (!__DEV__ && !isE2E) {
      router.replace('/host/login')
    }
  }, [isE2E])

  useEffect(() => {
    if (courtId && !selectedCourt) {
      fetchSingleCourt(courtId)
    }
  }, [courtId])

  async function fetchSingleCourt(id: string) {
    const { data } = await supabase.from('courts').select('*').eq('id', id).single()
    if (data) setSelectedCourt(data)
  }

  // 1. Fetch courts for searching
  useEffect(() => {
    if (currentStep === 'search') {
      fetchCourts()
    }
  }, [currentStep, search])

  async function fetchCourts() {
    setLoading(true)
    let query = supabase
      .from('courts')
      .select('id, name, address, city, district, owner_id')
      .is('owner_id', null)
    
    if (search) {
      query = query.ilike('name', `%${search}%`)
    }

    const { data } = await query.limit(10)
    setCourts(data || [])
    setLoading(false)
  }

  // 2. Handle Claim & Info
  const handleNextToConfig = () => {
    if (!businessName || !phone) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập Tên kinh doanh và Số điện thoại.')
      return
    }
    setCurrentStep('config')
  }

  // 3. Final Create Match Logic
  const handleCreateMatch = async () => {
    setLoading(true)
    try {
      // Step A: Create or Get Host (Simplified for Demo)
      // Note: In real app, we would use auth. Here we might create a temporary Host record
      const HostId = gen_random_uuid() // Placeholder for demo logic
      
      // Step B: Update Court Host
      await supabase.from('courts').update({ 
        owner_id: HostId, 
        sub_court_count: parseInt(subCourtCount, 10) 
      }).eq('id', selectedCourt.id)

      // Step C: Create Slot (Simplified)
      // We'd need a real slot_id. For demo, we'll assume there's an existing slot or create one.
      // This is a complex part of the existing schema. Let's simplify for the "Quick Start" demo.
      
      const { data: sessionData, error: sessionError } = await supabase.from('sessions').insert({
        title: `${selectedCourt.name} - ${format.toUpperCase()}`,
        status: 'open',
        max_players: parseInt(subCourtCount, 10) * 4,
        elo_min: 1000,
        elo_max: 2000,
        format_type: format,
        // ... other required fields
      }).select().single()

      if (sessionError) throw sessionError
      
      setCreatedSessionId(sessionData.id)
      setCurrentStep('finish')
    } catch (err: any) {
      console.error(err)
      Alert.alert('Lỗi', 'Không thể tạo kèo. Vui lòng thử lại.')
    } finally {
      setLoading(false)
    }
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 'search':
        return (
          <View style={styles.stepContainer}>
            <Text style={[styles.title, { color: theme.onBackground }]}>Chọn sân của bạn</Text>
            <AppInput 
              placeholder="Tìm tên sân..." 
              value={search} 
              onChangeText={setSearch} 
              leftIcon={<Search size={20} color={theme.outline} />}
            />
            {loading ? (
              <ActivityIndicator style={{ marginTop: 40 }} color={theme.primary} />
            ) : (
              <View style={{ marginTop: 20, gap: 12 }}>
                {courts.map(court => (
                  <Pressable 
                    key={court.id} 
                    onPress={() => router.push({ pathname: '/host/claim-court', params: { courtId: court.id } } as any)}
                    style={[styles.courtItem, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.courtName, { color: theme.onSurface }]}>{court.name}</Text>
                      <Text style={[styles.courtAddr, { color: theme.onSurfaceVariant }]}>{court.address}</Text>
                    </View>
                    <ChevronRight size={20} color={theme.primary} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )

      case 'info':
        return (
          <View style={styles.stepContainer}>
            <Text style={[styles.title, { color: theme.onBackground }]}>Xác nhận danh tính</Text>
            <View style={{ gap: 20 }}>
              <AppInput label="Tên kinh doanh / Chủ sân" value={businessName} onChangeText={setBusinessName} placeholder="VD: SM Pickleball Club" />
              <AppInput label="Số điện thoại Zalo" value={phone} onChangeText={setPhone} placeholder="09xx xxx xxx" keyboardType="phone-pad" />
              <AppButton label="Tiếp tục" onPress={handleNextToConfig} />
            </View>
          </View>
        )

      case 'config':
        return (
          <View style={styles.stepContainer}>
            <Text style={[styles.title, { color: theme.onBackground }]}>Cấu hình số sân con</Text>
            <Text style={{ color: theme.onSurfaceVariant, marginBottom: 24, fontFamily: SCREEN_FONTS.body }}>
              Bạn đang quản lý bao nhiêu sân Pickleball tại địa điểm này?
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 32 }}>
              {['1', '2', '4', '6'].map(val => (
                <AppChip 
                  key={val} 
                  label={`${val} Sân`} 
                  active={subCourtCount === val} 
                  onPress={() => setSubCourtCount(val)}
                  className="flex-1"
                />
              ))}
            </View>
            <AppButton label="Tiếp tục" onPress={() => setCurrentStep('create')} />
          </View>
        )

      case 'create':
        return (
          <View style={styles.stepContainer}>
            <Text style={[styles.title, { color: theme.onBackground }]}>Tạo kèo ngay</Text>
            <View style={{ gap: 20 }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}><AppInput label="Bắt đầu" value={startTime} onChangeText={setStartTime} /></View>
                <View style={{ flex: 1 }}><AppInput label="Kết thúc" value={endTime} onChangeText={setEndTime} /></View>
              </View>
              
              <Text style={[styles.label, { color: theme.onSurfaceVariant }]}>Hình thức chơi</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <AppChip label="Social Fun" active={format === 'social'} onPress={() => setFormat('social')} className="flex-1" />
                <AppChip label="Round Robin" active={format === 'round_robin'} onPress={() => setFormat('round_robin')} className="flex-1" />
              </View>

              <AppButton label="Chốt kèo & Chia sẻ" onPress={handleCreateMatch} loading={loading} />
            </View>
          </View>
        )

      case 'finish':
        const shareUrl = Linking.createURL(`/register/${createdSessionId}`)
        return (
          <View style={[styles.stepContainer, { alignItems: 'center', paddingTop: 40 }]}>
            <CheckCircle2 size={80} color={theme.primary} />
            <Text style={[styles.successTitle, { color: theme.onBackground }]}>Kèo đã sẵn sàng!</Text>
            <Text style={{ color: theme.onSurfaceVariant, textAlign: 'center', marginTop: 12, marginBottom: 40 }}>
              Gởi link này vào Group Zalo để người chơi đăng ký ngay.
            </Text>
            
            <View style={[styles.linkCard, { backgroundColor: theme.surfaceContainer, borderColor: theme.primary }]}>
              <Text numberOfLines={1} style={{ flex: 1, color: theme.primary, fontFamily: SCREEN_FONTS.label }}>{shareUrl}</Text>
              <Pressable onPress={() => { /* Copy to clipboard */ }}>
                <Share2 size={20} color={theme.primary} />
              </Pressable>
            </View>

            <AppButton label="Về trang quản lý" onPress={() => router.replace('/host/dashboard')} variant="secondary" style={{ marginTop: 24 }} />
          </View>
        )
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SecondaryNavbar title="DÀNH CHO CHỦ SÂN" onBackPress={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.header}>
          <Text style={[styles.headerText, { color: theme.primary }]}>PICKLEMATCH QUICK-START</Text>
          <View style={styles.progressRow}>
            {(['search', 'info', 'config', 'create', 'finish'] as Step[]).map((s, idx) => (
              <View key={s} style={[
                styles.dot, 
                { backgroundColor: theme.outlineVariant },
                idx <= ['search', 'info', 'config', 'create', 'finish'].indexOf(currentStep) && { backgroundColor: theme.primary }
              ]} />
            ))}
          </View>
        </View>
        
        {renderStepContent()}
      </ScrollView>
    </View>
  )
}

function gen_random_uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const styles = StyleSheet.create({
  header: {
    padding: SPACING.xl,
    alignItems: 'center',
    gap: 12
  },
  headerText: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 14,
    letterSpacing: 2
  },
  progressRow: {
    flexDirection: 'row',
    gap: 8
  },
  dot: {
    width: 20,
    height: 4,
    borderRadius: 2
  },
  stepContainer: {
    padding: SPACING.xl,
  },
  title: {
    fontSize: 28,
    fontFamily: SCREEN_FONTS.headline,
    marginBottom: 24
  },
  courtItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    ...SHADOW.xs
  },
  courtName: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 16,
    marginBottom: 4
  },
  courtAddr: {
    fontSize: 13,
    fontFamily: SCREEN_FONTS.body
  },
  label: {
    fontFamily: SCREEN_FONTS.headline,
    fontSize: 16,
    marginBottom: 8
  },
  successTitle: {
    fontSize: 24,
    fontFamily: SCREEN_FONTS.headline,
    marginTop: 20
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: 12,
    width: '100%'
  }
})
