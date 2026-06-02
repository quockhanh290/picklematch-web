import { AppButton, AppDialog, type AppDialogConfig, AppInput, StatusBadge } from '@/components/design'
import { ProfileSkillHero } from '@/components/profile/ProfileSections'
import { useAppTheme } from '@/lib/theme-context'
import { getEloBandByLevelId } from '@/lib/eloSystem'
import { getSkillLevelById, getSkillLevelFromPlayer, type SkillAssessmentLevel } from '@/lib/skillAssessment'
import { supabase } from '@/lib/supabase'
import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { UserCircle } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ImageBackground, ScrollView, Switch, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SHADOW } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'
import { WebContainer } from '@/components/design/WebContainer'
import { SecondaryNavbar } from '@/components/design/SecondaryNavbar'

const CITIES = ['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Cần Thơ', 'Hải Phòng']

type Court = { id: string; name: string; address: string; city: string }
type EditProfileInitialState = {
  name: string
  city: string
  autoAccept: boolean
  favoriteCourts: Court[]
  favoriteCourtIds: string[]
  bio: string
}

function ProfileSectionDivider({ index, title, theme }: { index: string; title: string; theme: any }) {
  const isFirst = index === '01' || index === '1'
  
  return (
    <View style={{ marginTop: isFirst ? 0 : 32, marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text 
          style={{ 
            fontFamily: SCREEN_FONTS.headline, 
            fontSize: 12, 
            color: theme.primary, 
            letterSpacing: 1.5 
          }}
        >
          {index}
        </Text>
        <View style={{ height: 1, flex: 1, backgroundColor: theme.outlineVariant, opacity: 0.5 }} />
      </View>
      <Text 
        style={{ 
          fontFamily: SCREEN_FONTS.headlineBlack, 
          fontSize: 24, 
          color: theme.onSurface, 
          marginTop: 4,
          textTransform: 'uppercase'
        }}
      >
        {title}
      </Text>
    </View>
  )
}

export default function EditProfile() {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [myId, setMyId] = useState<string | null>(null)
  const [elo, setElo] = useState(0)

  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [selectedLevelId, setSelectedLevelId] = useState<SkillAssessmentLevel['id']>('pvna_1')
  const [autoAccept, setAutoAccept] = useState(true)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [placementMatchesPlayed, setPlacementMatchesPlayed] = useState(0)
  const [bio, setBio] = useState('')

  const [keyword, setKeyword] = useState('')
  const [courts, setCourts] = useState<Court[]>([])
  const [searching, setSearching] = useState(false)
  const [favCourts, setFavCourts] = useState<Court[]>([])
  const [favCourtIds, setFavCourtIds] = useState<string[]>([])
  const [playerData, setPlayerData] = useState<any>(null)

  const [dialogConfig, setDialogConfig] = useState<AppDialogConfig | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollViewRef = useRef<ScrollView>(null)
  const initialStateRef = useRef<EditProfileInitialState | null>(null)

  useEffect(() => {
    void init()
  }, [])

  useEffect(() => {
    if (!keyword.trim()) {
      setCourts([])
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase
        .from('courts')
        .select('id, name, address, city')
        .ilike('name', `%${keyword.trim()}%`)
        .limit(20)

      setCourts(data ?? [])
      setSearching(false)
    }, 400)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [keyword])

  async function init() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.replace('/login' as any)
      return
    }

    setMyId(user.id)

    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()

    if (error) {
      setDialogConfig({
        title: 'Lỗi tải dữ liệu',
        message: 'Không thể tải thông tin hồ sơ. Vui lòng thử lại sau.',
        actions: [{ label: 'Đóng', onPress: () => router.back() }],
      })
      setLoading(false)
      return
    }

    setPlayerData(data)
    if (data) {
      setName(data.name ?? '')
      setCity(data.city ?? '')
      setPhotoUrl(data.photo_url ?? null)
      const rawElo = data.current_elo ?? data.elo ?? 0
      setPlacementMatchesPlayed(data.placement_matches_played ?? 0)
      setBio(data.bio ?? '')

      const skill = getSkillLevelFromPlayer(data)
      const levelId = skill?.id ?? 'pvna_1'
      setSelectedLevelId(levelId)
      
      let displayElo = rawElo
      if (rawElo === 0 && skill) {
        displayElo = getEloBandByLevelId(skill.id)?.seedElo ?? 900
      }
      setElo(displayElo)
      setAutoAccept(data.auto_accept ?? true)

      const ids: string[] = data.favorite_court_ids ?? []
      setFavCourtIds(ids)

      if (ids.length > 0) {
        const { data: courtData } = await supabase.from('courts').select('id, name, address, city').in('id', ids)
        const loadedCourts = courtData ?? []
        setFavCourts(loadedCourts)
        initialStateRef.current = {
          name: data.name ?? '',
          city: data.city ?? '',
          autoAccept: Boolean(data.auto_accept),
          favoriteCourts: loadedCourts,
          favoriteCourtIds: ids,
          bio: data.bio ?? '',
        }
      } else {
        initialStateRef.current = {
          name: data.name ?? '',
          city: data.city ?? '',
          autoAccept: Boolean(data.auto_accept),
          favoriteCourts: [],
          favoriteCourtIds: ids,
          bio: data.bio ?? '',
        }
      }
    } else {
      setElo(900)
      setSelectedLevelId('pvna_1')
      initialStateRef.current = {
        name: '', city: '', autoAccept: true, favoriteCourts: [], favoriteCourtIds: [], bio: '',
      }
    }

    setLoading(false)
  }

  function addFavCourt(court: Court) {
    if (favCourtIds.includes(court.id)) return
    if (favCourtIds.length >= 5) {
      setDialogConfig({
        title: STRINGS.profile.errors.max_courts,
        message: 'Xóa bớt sân để thêm sân mới.',
        actions: [{ label: STRINGS.common.back }],
      })
      return
    }
    setFavCourtIds((prev) => [...prev, court.id])
    setFavCourts((prev) => [...prev, court])
    setKeyword('')
    setCourts([])
  }

  function removeFavCourt(courtId: string) {
    setFavCourtIds((prev) => prev.filter((id) => id !== courtId))
    setFavCourts((prev) => prev.filter((court) => court.id !== courtId))
  }

  function handleRedoAssessment() {
    setDialogConfig({
      title: STRINGS.pvna_quiz.redo_quiz,
      message: 'Mức hiện tại sẽ được giữ nguyên cho tới khi bạn hoàn thành bài đánh giá PVNA mới. Sau đó hệ thống sẽ cập nhật mức khởi điểm phù hợp hơn.',
      actions: [
        { label: STRINGS.common.back, tone: 'secondary' },
        { label: 'Bắt đầu', onPress: () => router.replace('/onboarding' as any) },
      ],
    })
  }

  function sameIds(a: string[], b: string[]) {
    if (a.length !== b.length) return false
    return a.every((value, index) => value === b[index])
  }

  const hasUnsavedChanges = initialStateRef.current
    ? initialStateRef.current.name !== name ||
      initialStateRef.current.city !== city ||
      initialStateRef.current.autoAccept !== autoAccept ||
      initialStateRef.current.bio !== bio ||
      !sameIds(initialStateRef.current.favoriteCourtIds, favCourtIds)
    : false

  function cancelChanges() {
    const initial = initialStateRef.current
    if (!initial) return
    setName(initial.name)
    setCity(initial.city)
    setAutoAccept(initial.autoAccept)
    setBio(initial.bio)
    setFavCourtIds([...initial.favoriteCourtIds])
    setFavCourts([...initial.favoriteCourts])
    setKeyword('')
    setCourts([])
  }

  async function save() {
    if (!name.trim()) {
      setDialogConfig({ title: 'Lỗi', message: 'Tên không được để trống', actions: [{ label: 'Đã hiểu' }] })
      return
    }
    if (!myId) return
    setSaving(true)
    const updates = { name: name.trim(), city, bio: bio.trim(), favorite_court_ids: favCourtIds, auto_accept: autoAccept }
    const { error } = await supabase.from('players').upsert({
      id: myId,
      ...updates,
      ...(playerData ? {} : {
        current_elo: 900, elo: 900, self_assessed_level: 'pvna_1', skill_label: 'beginner', auto_accept: true
      })
    })
    setSaving(false)
    if (error) {
      setDialogConfig({ title: 'Lỗi', message: error.message, actions: [{ label: 'Đã hiểu' }] })
      return
    }
    setDialogConfig({
      title: STRINGS.profile.status.saved,
      message: 'Hồ sơ của bạn đã được cập nhật.',
      actions: [{ label: 'OK', onPress: () => router.back() }],
    })
  }

  const currentLevel = getSkillLevelById(selectedLevelId)
  const avatarSize = 100

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      
      <SecondaryNavbar 
        title={STRINGS.profile.edit_title}
        onBackPress={() => router.back()}
      />

      <ScrollView 
        ref={scrollViewRef} 
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 160 }} 
        keyboardShouldPersistTaps="always" 
        keyboardDismissMode="on-drag"
      >
        <WebContainer maxWidth={600}>
          {/* Avatar Section */}
          <View style={{ alignItems: 'center', marginTop: 40, marginBottom: 32 }}>
            <View
              style={{
                width: avatarSize,
                height: avatarSize,
                borderRadius: RADIUS.full,
                borderWidth: 4,
                borderColor: theme.surfaceContainerLow,
                backgroundColor: theme.secondaryFixed,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                ...SHADOW.sm
              }}
            >
              {photoUrl ? (
                <ImageBackground source={{ uri: photoUrl }} className="h-full w-full" resizeMode="cover" />
              ) : (
                <UserCircle size={avatarSize * 0.8} color={theme.primary} strokeWidth={1} />
              )}
            </View>
            <TouchableOpacity
              activeOpacity={0.8}
              style={{
                marginTop: -16,
                backgroundColor: theme.primary,
                paddingHorizontal: 16,
                paddingVertical: 6,
                borderRadius: RADIUS.full,
                ...SHADOW.sm,
              }}
            >
              <Text
                style={{
                  color: theme.onPrimary,
                  fontSize: 10,
                  fontFamily: SCREEN_FONTS.headline,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                {STRINGS.common.edit.toUpperCase()}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ gap: 8 }}>
            {/* 01. Basic Info */}
            <View>
              <ProfileSectionDivider index="01" title={STRINGS.profile.sections.info} theme={theme} />
              <View style={{ gap: 20 }}>
                <AppInput 
                  label={STRINGS.profile.fields.name} 
                  value={name} 
                  onChangeText={setName} 
                  placeholder="Nhập tên của bạn" 
                  maxLength={30} 
                />
                
                <AppInput
                  label={STRINGS.profile.fields.bio} 
                  value={bio} 
                  onChangeText={setBio} 
                  placeholder={STRINGS.profile.placeholders.bio} 
                  multiline
                  numberOfLines={3}
                  maxLength={200}
                />

                <View>
                  <Text
                    style={{ 
                      color: theme.onSurfaceVariant, 
                      fontFamily: SCREEN_FONTS.headline,
                      fontSize: 12,
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                      marginBottom: 10,
                      paddingLeft: 4
                    }}
                  >
                    {STRINGS.profile.fields.city}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {CITIES.map((item) => {
                      const isActive = city.trim().toLowerCase() === item.toLowerCase()
                      return (
                        <TouchableOpacity
                          key={item}
                          activeOpacity={0.85}
                          style={{
                            paddingHorizontal: 20,
                            paddingVertical: 10,
                            borderRadius: RADIUS.full,
                            backgroundColor: isActive ? theme.primary : theme.surfaceContainerLow,
                            borderWidth: 1,
                            borderColor: isActive ? theme.primary : theme.outlineVariant,
                          }}
                          onPress={() => setCity(item)}
                        >
                          <Text
                            style={{
                              color: isActive ? theme.onPrimary : theme.onSurface,
                              fontFamily: SCREEN_FONTS.headline,
                              fontSize: 13,
                              letterSpacing: 0.5
                            }}
                          >
                            {item.toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                </View>
              </View>
            </View>

            {/* 02. Skill Level */}
            <View>
              <ProfileSectionDivider index="02" title={STRINGS.profile.sections.skill} theme={theme} />
              <ProfileSkillHero
                elo={elo}
                title={currentLevel?.title ?? 'Đang hiệu chỉnh'}
                subtitle={currentLevel?.subtitle ?? 'Mức khởi điểm hiện tại. Hệ thống sẽ tiếp tục tinh chỉnh sau vài trận.'}
                subtitleItalic
                description={currentLevel?.description ?? ''}
                contentRightInset={12}
                levelId={selectedLevelId}
              />

              <View style={{ marginTop: 20 }}>
                {placementMatchesPlayed < 5 ? (
                  <View style={{ gap: 16 }}>
                    <AppButton 
                      label="LÀM BÀI ĐÁNH GIÁ PVNA"
                      onPress={handleRedoAssessment}
                      style={{ backgroundColor: theme.error }}
                    />
                    <Text
                      style={{ 
                        color: theme.onSurfaceVariant, 
                        fontFamily: SCREEN_FONTS.body,
                        fontSize: 13,
                        textAlign: 'center',
                        lineHeight: 20,
                        paddingHorizontal: 20
                      }}
                    >
                      Dùng bài test chuẩn PVNA để hệ thống ước lượng mức khởi điểm mới cho bạn.
                    </Text>
                  </View>
                ) : (
                  <View 
                    style={{ 
                      borderRadius: RADIUS.lg, padding: 20, 
                      borderWidth: 1, borderStyle: 'dashed',
                      borderColor: theme.outlineVariant,
                      backgroundColor: theme.surfaceContainerLow + '40'
                    }}
                  >
                    <Text
                      style={{ 
                        color: theme.onSurfaceVariant, 
                        fontFamily: SCREEN_FONTS.body,
                        fontSize: 13,
                        textAlign: 'center',
                        lineHeight: 20
                      }}
                    >
                      Bạn đã hoàn thành giai đoạn phân hạng. Trình độ của bạn giờ đây sẽ được cập nhật tự động dựa trên kết quả thi đấu thực tế.
                    </Text>
                  </View>
                )}
              </View>
            </View>

            </View>
        </WebContainer>
      </ScrollView>

      {/* Floating Action Buttons */}
      <View
        style={{ 
          position: 'absolute', bottom: 0, left: 0, right: 0,
          paddingBottom: insets.bottom + 20, paddingHorizontal: 24, paddingTop: 20,
          backgroundColor: theme.background + 'F0',
          borderTopWidth: 1, borderColor: theme.outlineVariant + '40',
        }}
      >
        <WebContainer maxWidth={600}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={cancelChanges}
              disabled={saving || !hasUnsavedChanges}
              style={{
                flex: 1, height: 56, borderRadius: RADIUS.full,
                backgroundColor: theme.surfaceContainerLow,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: theme.outlineVariant,
                opacity: saving || !hasUnsavedChanges ? 0.5 : 1
              }}
            >
              <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 14, letterSpacing: 1 }}>
                {STRINGS.profile.actions.cancel.toUpperCase()}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={save}
              disabled={saving}
              style={{
                flex: 2, height: 56, borderRadius: RADIUS.full,
                backgroundColor: theme.primary,
                alignItems: 'center', justifyContent: 'center',
                ...SHADOW.md
              }}
            >
              {saving ? (
                <ActivityIndicator color={theme.onPrimary} />
              ) : (
                <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headlineBlack, fontSize: 14, letterSpacing: 1 }}>
                  {STRINGS.profile.actions.save.toUpperCase()}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </WebContainer>
      </View>

      <AppDialog
        visible={Boolean(dialogConfig)}
        config={dialogConfig}
        onClose={() => setDialogConfig(null)}
      />
    </View>
  )
}



