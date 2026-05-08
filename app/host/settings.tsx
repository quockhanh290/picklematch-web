import { SecondaryNavbar } from '@/components/design'
import { supabase } from '@/lib/supabase'
import { router } from 'expo-router'
import { LogOut, User, Landmark, Shield } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { StatusBar } from 'expo-status-bar'
import { 
  Text, 
  TouchableOpacity, 
  View, 
  ScrollView
} from 'react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER, SHADOW as LAYOUT_SHADOW } from '@/constants/screenLayout'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function HostSettingsScreen() {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/host/login')
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="dark" />
      <SecondaryNavbar title="CÀI ĐẶT CHỦ SÂN" />

      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View style={{ 
          backgroundColor: theme.surface, 
          borderRadius: RADIUS.xl, 
          padding: 8,
          borderWidth: BORDER.base,
          borderColor: theme.outlineVariant,
          ...LAYOUT_SHADOW.xs
        }}>
          <TouchableOpacity 
            onPress={() => router.push('/host/edit-profile')}
            style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16 }}
          >
            <View style={{ width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: theme.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' }}>
              <User size={20} color={theme.primary} />
            </View>
            <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.onSurface }}>Hồ sơ cá nhân</Text>
          </TouchableOpacity>

          <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginHorizontal: 16 }} />

          <TouchableOpacity 
            onPress={() => router.push('/host/court-config')}
            style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16 }}
          >
            <View style={{ width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: theme.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' }}>
              <Landmark size={20} color={theme.primary} />
            </View>
            <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.onSurface }}>Thông tin sân</Text>
          </TouchableOpacity>

          <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginHorizontal: 16 }} />

          <TouchableOpacity 
            onPress={handleLogout}
            style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16 }}
          >
            <View style={{ width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: '#FFF0F0', alignItems: 'center', justifyContent: 'center' }}>
              <LogOut size={20} color="#FF4444" />
            </View>
            <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: '#FF4444' }}>Đăng xuất</Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: 40, alignItems: 'center' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.outline }}>
            PICKLEMATCH Host v1.0.0
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}
