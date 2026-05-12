import { RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

type Props = {
  players: ArrangementPlayer[]
  scheduledPlayers: ArrangementPlayer[]
  hasPendingSchedule: boolean
  needsScheduleRefresh: boolean
  updatingPlayerId?: string | null
  onSetPlayerStatus: (playerId: string, status: 'present' | 'no_show') => void
  onRegenerateSchedule: () => void
}

export function MatchPlayerManagementPanel({
  players,
  scheduledPlayers,
  hasPendingSchedule,
  needsScheduleRefresh,
  updatingPlayerId,
  onSetPlayerStatus,
  onRegenerateSchedule,
}: Props) {
  const activePlayers = players.filter(player => player.status === 'confirmed' && player.checkInStatus !== 'no_show')
  const unavailablePlayers = players.filter(player => player.status === 'confirmed' && player.checkInStatus === 'no_show')
  const scheduledCount = scheduledPlayers.length || activePlayers.length

  return (
    <View style={{ backgroundColor: '#F9F8F4', borderRadius: RADIUS.lg, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: needsScheduleRefresh ? '#F5DFA0' : '#E5E3DC' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900' }}>
            NGUOI CHOI HOM NAY
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 2 }}>
            Dang choi {activePlayers.length}/{players.filter(player => player.status === 'confirmed').length}. Lich hien tai dung {scheduledCount} nguoi.
          </Text>
        </View>

        {needsScheduleRefresh && hasPendingSchedule && (
          <TouchableOpacity
            onPress={onRegenerateSchedule}
            style={{ backgroundColor: '#A05A16', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }}
          >
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: 'white', fontWeight: '900' }}>
              Tao lai lich
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {needsScheduleRefresh && hasPendingSchedule && (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#854F0B', lineHeight: 15, marginBottom: 10 }}>
          Danh sach nguoi choi da khac voi lich dang cho. Cac tran da xong/live van giu nguyen, nen tao lai phan lich chua bat dau.
        </Text>
      )}

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {players.filter(player => player.status === 'confirmed').map(player => {
          const id = String(player.id)
          const isActive = player.checkInStatus !== 'no_show'
          const isUpdating = updatingPlayerId === id

          return (
            <View key={id} style={{ backgroundColor: 'white', borderRadius: RADIUS.md, padding: 8, borderWidth: 1, borderColor: isActive ? '#D9E9DF' : '#F0C9BD', minWidth: 128 }}>
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#1A2E2A', fontWeight: '900' }} numberOfLines={1}>
                {player.name}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 7 }}>
                <TouchableOpacity
                  onPress={() => onSetPlayerStatus(id, 'present')}
                  disabled={isUpdating || isActive}
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingVertical: 5,
                    alignItems: 'center',
                    backgroundColor: isActive ? '#0F6E56' : '#F5F1E8',
                    opacity: isUpdating ? 0.6 : 1,
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: isActive ? 'white' : '#596864', fontWeight: '800' }}>
                    Choi
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onSetPlayerStatus(id, 'no_show')}
                  disabled={isUpdating || !isActive}
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingVertical: 5,
                    alignItems: 'center',
                    backgroundColor: !isActive ? '#D85A30' : '#F5F1E8',
                    opacity: isUpdating ? 0.6 : 1,
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 9, color: !isActive ? 'white' : '#596864', fontWeight: '800' }}>
                    Nghi
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        })}
      </View>

      {unavailablePlayers.length > 0 && (
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#9C968A', marginTop: 10 }}>
          Dang nghi: {unavailablePlayers.map(player => player.name).join(', ')}
        </Text>
      )}
    </View>
  )
}
