import React, { useState, useMemo } from 'react'
import { View, Text, ScrollView, Platform, Alert, ActivityIndicator, Pressable } from 'react-native'
import { CheckCircle2, XCircle, Users, Check } from 'lucide-react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SHADOW } from '@/constants/screenLayout'
import type { SessionPlayer } from '@/hooks/useSessionDetail'
import { supabase } from '@/lib/supabase'
import { STRINGS } from '@/constants/strings'
import { syncLiveRosterFromSessionPlayers } from './next-round-v2/api'

interface Props {
  sessionId: string
  players: SessionPlayer[]
  onUpdated: () => void
  onClose: () => void
}

export function HostCheckInScreen({ sessionId, players, onUpdated, onClose }: Props) {
  const theme = useAppTheme()
  const [submitting, setSubmitting] = useState(false)
  
  const confirmedPlayers = useMemo(() => players.filter(p => p.status === 'confirmed'), [players])

  const [statuses, setStatuses] = useState<Record<string, 'present' | 'pending'>>(() => {
    const s: Record<string, 'present' | 'pending'> = {}
    confirmedPlayers.forEach(p => {
      s[p.player_id] = p.check_in_status === 'pending' || p.check_in_status === 'no_show' ? 'pending' : 'present'
    })
    return s
  })

  const handleToggleStatus = (playerId: string, status: 'present' | 'pending') => {
    setStatuses(prev => ({ ...prev, [playerId]: status }))
  }

  const handleComplete = async () => {
    const pendingCount = confirmedPlayers.length - Object.keys(statuses).length
    if (pendingCount > 0) {
      Alert.alert(STRINGS.host_flow.check_in.alert_incomplete, STRINGS.host_flow.check_in.alert_confirm_all)
      return
    }

    const message = STRINGS.host_flow.check_in.confirm_message
    const confirmAction = async () => {
      setSubmitting(true)
      try {
        // Save statuses in parallel
        await Promise.all(Object.keys(statuses).map(pid => 
          supabase.from('session_players').update({ check_in_status: statuses[pid] }).eq('session_id', sessionId).eq('player_id', pid)
        ))
        
        const { error } = await supabase.rpc('complete_session_check_in', { p_session_id: sessionId })
        if (error) throw error
        await syncLiveRosterFromSessionPlayers(
          sessionId,
          Object.entries(statuses)
            .filter(([, status]) => status === 'present')
            .map(([playerId]) => playerId),
        )
        onUpdated()
        onClose()
      } catch (err) {
        Alert.alert('Lỗi', STRINGS.host_flow.check_in.error_complete)
      } finally {
        setSubmitting(false)
      }
    }

    if (Platform.OS === 'web') {
      if (window.confirm(message)) await confirmAction()
    } else {
      Alert.alert(STRINGS.host_flow.check_in.confirm_title, message, [{ text: 'QUAY LẠI', style: 'cancel' }, { text: 'XÁC NHẬN', onPress: confirmAction }])
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }} testID="host-check-in-screen">
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        {confirmedPlayers.length === 0 ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 12 }}>
            <Users size={48} color={theme.outline} opacity={0.5} />
            <Text style={{ fontFamily: SCREEN_FONTS.body, color: theme.onSurfaceVariant, textAlign: 'center' }}>
              {STRINGS.host_flow.check_in.no_players}
            </Text>
          </View>
        ) : (
          confirmedPlayers.map(p => {
            const status = statuses[p.player_id]
            const isPresent = status === 'present'
            const isPending = status === 'pending'

            return (
              <View key={p.player_id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.outlineVariant }}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.onSurface }}>{p.player?.name}</Text>
                </View>
                
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {/* Present Button */}
                  <Pressable 
                    onPress={() => handleToggleStatus(p.player_id, 'present')} 
                    style={({ pressed }) => ({
                      flexDirection: 'row', 
                      alignItems: 'center', 
                      gap: 4, 
                      paddingHorizontal: 12, 
                      paddingVertical: 8, 
                      borderRadius: 8, 
                      backgroundColor: isPresent ? theme.primary : theme.surfaceVariant,
                      opacity: pressed ? 0.8 : 1,
                      borderWidth: 1,
                      borderColor: isPresent ? theme.primary : theme.outlineVariant
                    })}
                  >
                    <CheckCircle2 size={14} color={isPresent ? '#fff' : theme.outline} />
                    <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: isPresent ? '#fff' : theme.outline, fontWeight: '700' }}>CÓ MẶT</Text>
                  </Pressable>

                  {/* No Show Button */}
                  <Pressable 
                    onPress={() => handleToggleStatus(p.player_id, 'pending')} 
                    style={({ pressed }) => ({
                      flexDirection: 'row', 
                      alignItems: 'center', 
                      gap: 4, 
                      paddingHorizontal: 12, 
                      paddingVertical: 8, 
                      borderRadius: 8, 
                      backgroundColor: isPending ? '#FAEEDA' : theme.surfaceVariant,
                      opacity: pressed ? 0.8 : 1,
                      borderWidth: 1,
                      borderColor: isPending ? '#EF9F27' : theme.outlineVariant
                    })}
                  >
                    <XCircle size={14} color={isPending ? '#854F0B' : theme.outline} />
                    <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: isPending ? '#854F0B' : theme.outline, fontWeight: '700' }}>CHƯA TỚI</Text>
                  </Pressable>
                </View>
              </View>
            )
          })
        )}
      </ScrollView>

      <View style={{ padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24, borderTopWidth: 1, borderTopColor: theme.outlineVariant }}>
        <Pressable 
          onPress={handleComplete} 
          disabled={submitting} 
          style={({ pressed }) => ({ 
            backgroundColor: theme.primary, 
            paddingVertical: 16, 
            borderRadius: RADIUS.xl, 
            alignItems: 'center', 
            justifyContent: 'center', 
            flexDirection: 'row', 
            gap: 10, 
            ...SHADOW.md, 
            opacity: submitting ? 0.7 : (pressed ? 0.9 : 1) 
          })}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <><Check size={20} color="#fff" /><Text style={{ color: '#fff', fontSize: 16, fontFamily: SCREEN_FONTS.headline, fontWeight: '700' }}>{STRINGS.host_flow.check_in.complete}</Text></>}
        </Pressable>
      </View>
    </View>
  )
}
