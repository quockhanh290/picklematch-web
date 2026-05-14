import { RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import React, { useMemo, useState } from 'react'
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

const PREVIEW_LIMIT = 12
const AVATAR_COLORS = ['#7C5CC4', '#0F766E', '#A05A16', '#D85A30', '#4F46E5', '#66736F']

function getPlayerSkill(player: ArrangementPlayer) {
  return Number(player.pvna || (player.elo ? player.elo / 100 : 0) || 0)
}

function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

function getAvatarColor(id: string) {
  let total = 0
  for (let index = 0; index < id.length; index++) total += id.charCodeAt(index)
  return AVATAR_COLORS[total % AVATAR_COLORS.length]
}

function getGenderLabel(gender?: string | null) {
  const normalized = String(gender || '').toLowerCase()
  if (normalized.startsWith('f') || normalized.includes('nu') || normalized.includes('nữ')) return 'Nữ'
  return 'Nam'
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
  const [showAllPlayers, setShowAllPlayers] = useState(false)
  const confirmedPlayers = useMemo(
    () => players.filter(player => player.status === 'confirmed'),
    [players]
  )
  const activePlayers = confirmedPlayers.filter(player => player.checkInStatus !== 'no_show')
  const restingPlayers = confirmedPlayers.filter(player => player.checkInStatus === 'no_show')
  const scheduledCount = scheduledPlayers.length || activePlayers.length
  const visiblePlayers = showAllPlayers ? confirmedPlayers : confirmedPlayers.slice(0, PREVIEW_LIMIT)
  const hiddenCount = Math.max(0, confirmedPlayers.length - visiblePlayers.length)

  const setAllPlayersStatus = (status: 'present' | 'no_show') => {
    confirmedPlayers.forEach(player => {
      const isResting = player.checkInStatus === 'no_show'
      if (status === 'present' && isResting) onSetPlayerStatus(String(player.id), 'present')
      if (status === 'no_show' && !isResting) onSetPlayerStatus(String(player.id), 'no_show')
    })
  }

  return (
    <View style={{ backgroundColor: '#FFFCF5', borderRadius: RADIUS.lg, marginBottom: 16, borderWidth: 1, borderColor: needsScheduleRefresh ? '#E7C66A' : '#E5E3DC', overflow: 'hidden' }}>
      <View style={{ paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#E5E3DC', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#9C968A', fontWeight: '900' }}>
          NGƯỜI CHƠI HÔM NAY
        </Text>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', fontWeight: '700' }}>
          Chọn ai có mặt
        </Text>
      </View>

      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E5E3DC' }}>
        {[
          { label: 'SẼ CHƠI', value: activePlayers.length, color: '#0F6E56' },
          { label: 'NGHỈ', value: restingPlayers.length, color: '#D85A30' },
          { label: 'TỔNG', value: confirmedPlayers.length, color: '#1A2E2A' },
        ].map((item, index) => (
          <View key={item.label} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRightWidth: index < 2 ? 1 : 0, borderRightColor: '#E5E3DC' }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 22, color: item.color, fontWeight: '900' }}>
              {item.value}
            </Text>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', fontWeight: '800' }}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Text style={{ flex: 1, fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#596864', fontWeight: '800' }}>
          Danh sách người chơi
        </Text>
        <TouchableOpacity onPress={() => setAllPlayersStatus('present')} style={{ backgroundColor: '#E1F5EE', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: '#0F6E56', fontWeight: '900' }}>Tất cả chơi</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setAllPlayersStatus('no_show')} style={{ backgroundColor: '#FFF5DE', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: '#D85A30', fontWeight: '900' }}>Tất cả nghỉ</Text>
        </TouchableOpacity>
      </View>

      {needsScheduleRefresh && hasPendingSchedule && (
        <View style={{ backgroundColor: '#FFF5DE', borderRadius: RADIUS.md, padding: 10, marginHorizontal: 14, marginBottom: 10, borderWidth: 1, borderColor: '#E7C66A' }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#854F0B', lineHeight: 15 }}>
            Danh sách người chơi đã khác với lịch đang chờ. Các trận đã live hoặc đã xong vẫn giữ nguyên.
          </Text>
          <TouchableOpacity onPress={onRegenerateSchedule} style={{ alignSelf: 'flex-start', backgroundColor: '#A05A16', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, marginTop: 8 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: 'white', fontWeight: '900' }}>Tạo lại lịch</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ paddingHorizontal: 8, paddingBottom: 14, gap: 7 }}>
        {visiblePlayers.map(player => {
          const id = String(player.id)
          const isActive = player.checkInStatus !== 'no_show'
          const isUpdating = updatingPlayerId === id
          const skill = getPlayerSkill(player)
          const genderLabel = getGenderLabel(player.gender)
          const genderColor = genderLabel === 'Nữ' ? '#D85A30' : '#0F766E'

          return (
            <View key={id} style={{ backgroundColor: isActive ? 'white' : '#F8F4EA', borderRadius: RADIUS.md, padding: 10, borderWidth: 1, borderColor: isActive ? '#E5E3DC' : '#ECE3D3', opacity: isActive ? 1 : 0.78, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: getAvatarColor(id), alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: 'white', fontWeight: '900' }}>{getInitials(player.name)}</Text>
                <View style={{ position: 'absolute', right: -1, bottom: -1, width: 8, height: 8, borderRadius: 4, backgroundColor: genderColor, borderWidth: 1, borderColor: 'white' }} />
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: '#1A2E2A', fontWeight: '900' }} numberOfLines={1}>
                  {player.name}
                </Text>
                <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: '#7A8884', marginTop: 1 }} numberOfLines={1}>
                  {genderLabel} · {skill.toFixed(2)}
                </Text>
              </View>

              <View style={{ width: 96, height: 28, borderRadius: 999, backgroundColor: '#F5F1E8', flexDirection: 'row', alignItems: 'center', padding: 3 }}>
                <TouchableOpacity
                  onPress={() => onSetPlayerStatus(id, 'present')}
                  disabled={isUpdating || isActive}
                  style={{ flex: 1, height: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: isActive ? '#0F6E56' : 'transparent', opacity: isUpdating ? 0.6 : 1 }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: isActive ? 'white' : '#B4B2A9', fontWeight: '900' }}>Chơi</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => onSetPlayerStatus(id, 'no_show')}
                  disabled={isUpdating || !isActive}
                  style={{ flex: 1, height: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: !isActive ? '#D85A30' : 'transparent', opacity: isUpdating ? 0.6 : 1 }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: !isActive ? 'white' : '#B4B2A9', fontWeight: '900' }}>Nghỉ</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        })}

        {hiddenCount > 0 && (
          <TouchableOpacity onPress={() => setShowAllPlayers(true)} style={{ alignItems: 'center', paddingVertical: 12 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 12, color: '#B4B2A9', fontWeight: '800' }}>
              ... và {hiddenCount} người chơi khác
            </Text>
          </TouchableOpacity>
        )}

        {showAllPlayers && confirmedPlayers.length > PREVIEW_LIMIT && (
          <TouchableOpacity onPress={() => setShowAllPlayers(false)} style={{ alignItems: 'center', paddingVertical: 12 }}>
            <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#0F6E56', fontWeight: '900' }}>
              Thu gọn danh sách
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}
