import { RADIUS } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { SchedulePriority } from '@/lib/roundRobinScheduler'
import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

export type ScheduleMode = 'full' | 'limited'

type Props = {
  activePlayerCount: number
  defaultCourtCount: number
  scheduleMode: ScheduleMode
  onScheduleModeChange: (mode: ScheduleMode) => void
  schedulePriority: SchedulePriority
  onSchedulePriorityChange: (priority: SchedulePriority) => void
  minGamesPerPlayer: number
  onMinGamesPerPlayerChange: (count: number) => void
  scheduleCourtCount: number
  onScheduleCourtCountChange: (count: number) => void
}

export function ScheduleSetupPanel({
  activePlayerCount,
  defaultCourtCount,
  scheduleMode,
  onScheduleModeChange,
  schedulePriority,
  onSchedulePriorityChange,
  minGamesPerPlayer,
  onMinGamesPerPlayerChange,
  scheduleCourtCount,
  onScheduleCourtCountChange,
}: Props) {
  const maxCourtOptions = Math.max(1, Math.floor(activePlayerCount / 4))
  const maxGameOptions = Math.max(1, activePlayerCount - 1)

  return (
    <View style={{ backgroundColor: '#F5F1E8', borderRadius: RADIUS.lg, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#E5E3DC' }}>
      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#596864', marginBottom: 8 }}>
        CHE DO TAO LICH
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {[
          { id: 'full' as const, label: 'Full rotation' },
          { id: 'limited' as const, label: 'Toi thieu tran' },
        ].map(mode => {
          const active = scheduleMode === mode.id
          return (
            <TouchableOpacity
              key={mode.id}
              onPress={() => onScheduleModeChange(mode.id)}
              style={{
                flex: 1,
                paddingVertical: 9,
                borderRadius: RADIUS.md,
                backgroundColor: active ? '#0F6E56' : 'white',
                borderWidth: 1,
                borderColor: active ? '#0F6E56' : '#D5D2C8',
                alignItems: 'center'
              }}
            >
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: active ? 'white' : '#596864', fontWeight: '800' }}>
                {mode.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {scheduleMode === 'limited' && (
        <>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#596864', marginBottom: 8 }}>
            UU TIEN XEP LICH
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {[
              { id: 'balanced' as const, label: 'Can bang' },
              { id: 'partner' as const, label: 'Doi partner' },
              { id: 'opponent' as const, label: 'Gap doi thu' },
            ].map(priority => {
              const active = schedulePriority === priority.id
              return (
                <TouchableOpacity
                  key={priority.id}
                  onPress={() => onSchedulePriorityChange(priority.id)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: RADIUS.md,
                    backgroundColor: active ? '#A05A16' : 'white',
                    borderWidth: 1,
                    borderColor: active ? '#A05A16' : '#D5D2C8',
                    alignItems: 'center'
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 10, color: active ? 'white' : '#596864', fontWeight: '800' }}>
                    {priority.label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </>
      )}

      {scheduleMode === 'limited' && (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginBottom: 6 }}>
            So tran toi thieu moi nguoi
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {Array.from({ length: maxGameOptions }).map((_, idx) => {
              const count = idx + 1
              const active = minGamesPerPlayer === count
              return (
                <TouchableOpacity
                  key={count}
                  onPress={() => onMinGamesPerPlayerChange(count)}
                  style={{
                    minWidth: 36,
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: active ? '#7c3aed' : 'white',
                    borderWidth: 1,
                    borderColor: active ? '#7c3aed' : '#D5D2C8',
                    alignItems: 'center'
                  }}
                >
                  <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: active ? 'white' : '#596864', fontWeight: '800' }}>
                    {count}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      )}

      <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: '#596864', marginBottom: 8 }}>
        SO SAN DUNG DE TEST LICH
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {Array.from({ length: maxCourtOptions }).map((_, idx) => {
          const count = idx + 1
          const active = scheduleCourtCount === count
          return (
            <TouchableOpacity
              key={count}
              onPress={() => onScheduleCourtCountChange(count)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                backgroundColor: active ? '#0F6E56' : 'white',
                borderWidth: 1,
                borderColor: active ? '#0F6E56' : '#D5D2C8'
              }}
            >
              <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 11, color: active ? 'white' : '#596864', fontWeight: '800' }}>
                {count} san
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
      <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#7A8884', marginTop: 8 }}>
        Mac dinh keo co {defaultCourtCount} san. Tuy chon nay chi dung de generate/test lich tren man nay.
      </Text>
    </View>
  )
}
