import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import {  Users, AlertTriangle, CheckCircle2, XCircle, PlusCircle, Pencil, Check, Trash2, Clock, Settings2 } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Text, View, TouchableOpacity, Platform, LayoutAnimation, Alert } from 'react-native'
import { router } from 'expo-router'
import { RADIUS, BORDER, SHADOW } from '@/constants/screenLayout'
import { getInitials } from '@/lib/sessionDetail'
import type { ArrangementPlayer } from '@/lib/sessionDetail'
import React, { useMemo } from 'react'

type Props = {
  players: ArrangementPlayer[]
  maxPlayers: number
  sessionStatus: string
  hostId?: string
  hideEmptySlots?: boolean
  requireApproval?: boolean
  sessionId?: string
  onUpdated?: () => void
  onArrangementPress?: () => void
  checkInCompleted?: boolean
  isCheckInMode?: boolean
  startTime?: string
  isHost?: boolean
  isAfterEnd?: boolean
}

function EmptySlot({ count, sessionId, startTime, isHost, sessionStatus, isAfterEnd }: { count: number, sessionId?: string, startTime?: string, isHost?: boolean, sessionStatus?: string, isAfterEnd?: boolean }) {
  const theme = useAppTheme()
  
  // Only show Add Button for host and if session starts within 90 minutes
  const showAddButton = useMemo(() => {
    if (!isHost || !startTime || !sessionId) return false
    const start = new Date(startTime)
    const timeDiff = start.getTime() - Date.now()
    const minutesUntilStart = timeDiff / (1000 * 60)
    const isEnded = ['done', 'pending_completion', 'pending_results', 'completed', 'finished', 'archived', 'cancelled_no_players', 'failed_to_fill', 'cancelled'].includes(sessionStatus || '')
    return minutesUntilStart > 0 && minutesUntilStart <= 90 && !isEnded && !isAfterEnd
  }, [startTime, sessionId, isHost, isAfterEnd])

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: RADIUS.lg,
        borderWidth: BORDER.base,
        borderColor: theme.outlineVariant,
        backgroundColor: theme.surfaceContainerLowest,
        paddingHorizontal: 12,
        paddingVertical: 10,
        opacity: 0.8,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: RADIUS.full,
          backgroundColor: theme.surfaceVariant,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 10,
        }}
      >
        <Users size={16} color={theme.onSurfaceVariant} opacity={0.6} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.onSurfaceVariant }}>
          Còn trống {count} chỗ
        </Text>
        <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onSurfaceVariant, opacity: 0.6, fontStyle: 'italic' }}>
          Đang chờ người tham gia...
        </Text>
      </View>

      {showAddButton && (
        <TouchableOpacity
          onPress={() => router.push(`/register/${sessionId}`)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            backgroundColor: theme.primary,
            borderRadius: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6
          }}
        >
          <PlusCircle size={14} color={theme.onPrimary} />
          <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 11 }}>THÊM KHÁCH</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

export function HostRosterSection({
  players,
  maxPlayers,
  sessionStatus,
  hostId,
  hideEmptySlots = false,
  requireApproval = false,
  sessionId,
  onUpdated,
  onArrangementPress,
  checkInCompleted = false,
  isCheckInMode = false,
  startTime,
  isHost = false,
  isAfterEnd = false
}: Props) {
  const theme = useAppTheme()
  // Local state for instant feedback
  const [localStatuses, setLocalStatuses] = React.useState<Record<string, string>>({})
  const [removedPlayerIds, setRemovedPlayerIds] = React.useState<Set<string>>(new Set())
  const [isEditMode, setIsEditMode] = React.useState(false)
  const [showManualManagement, setShowManualManagement] = React.useState(false)
  const layoutSignatureRef = React.useRef('')

  // Filter out locally removed players
  const activePlayers = useMemo(() => {
    return players.filter(p => !removedPlayerIds.has(p.id))
  }, [players, removedPlayerIds])

  const confirmedPlayers = activePlayers.filter(p => p.status === 'confirmed')
  const spotsLeft = Math.max(0, maxPlayers - confirmedPlayers.length)

  // Show Add Guest button for Host regardless of spots
  const showAddButton = useMemo(() => {
    if (!isHost || !sessionId) return false
    // You can add more conditions here (e.g. only if not finished)
    const isEnded = ['done', 'pending_completion', 'pending_results', 'completed', 'finished', 'archived', 'cancelled_no_players', 'failed_to_fill', 'cancelled'].includes(sessionStatus || '')
    return !isEnded && !isAfterEnd
  }, [sessionId, sessionStatus, isHost, isAfterEnd])

  // Sync local status when players change
  React.useEffect(() => {
    setLocalStatuses(prev => {
      const next = { ...prev }
      activePlayers.forEach(p => {
        const serverStatus = (p as any).checkInStatus
        if (serverStatus && serverStatus !== 'pending') {
          next[p.id] = serverStatus
        } else if (serverStatus === 'pending' && !next[p.id]) {
          // Only delete if we don't have a local optimistic status
          delete next[p.id]
        }
      })
      return next
    })
    
    // Clear removed IDs that are no longer in the server response anyway
    setRemovedPlayerIds(prev => {
      if (prev.size === 0) return prev
      const serverIds = new Set(players.map(p => p.id))
      let changed = false
      const next = new Set(prev)
      prev.forEach(id => {
        if (!serverIds.has(id)) {
          next.delete(id)
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [players])
  // Add layout animation when players change
  React.useEffect(() => {
    const nextSignature = activePlayers.map(player => player.id).join('|')
    if (layoutSignatureRef.current === nextSignature) return
    layoutSignatureRef.current = nextSignature
    if (Platform.OS !== 'web') {
      try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut) } catch {}
    }
  }, [activePlayers])

  const AVATAR_COLORS = [
    { bg: '#EDE4FE', text: '#5B2D9E' },
    { bg: '#E1F5EE', text: '#0F6E56' },
    { bg: '#FAEEDA', text: '#854F0B' },
    { bg: '#FAECE7', text: '#993C1D' },
    { bg: '#F1EFE8', text: '#7A8884' },
  ]

  const getAvatarColor = (name: string) => {
    const charCode = (name || '').length > 0 ? (name || '').charCodeAt(0) : 0
    const index = charCode % AVATAR_COLORS.length
    return AVATAR_COLORS[index]
  }

  const renderContent = () => {
    if (activePlayers.length === 0) {
      return (
        <View style={{ 
          padding: 32, 
          alignItems: 'center', 
          backgroundColor: theme.surfaceContainerLowest,
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: theme.outlineVariant,
          borderStyle: 'dashed'
        }}>
          <Users size={40} color={theme.outline} strokeWidth={1.5} />
          <Text style={{ marginTop: 12, fontFamily: SCREEN_FONTS.headline, color: theme.onSurfaceVariant }}>Chưa có người tham gia</Text>
        </View>
      )
    }

    const getEffectiveCheckInStatus = (player: ArrangementPlayer) => (
      localStatuses[player.id] || (player as any).checkInStatus || 'pending'
    )

    const confirmed = activePlayers.filter(p => {
      const status = getEffectiveCheckInStatus(p)
      return p.status === 'confirmed' && status !== 'no_show' && status !== 'pending'
    })
    const noShows = activePlayers.filter(p => {
      const status = getEffectiveCheckInStatus(p)
      return status === 'no_show' || status === 'pending'
    })
    const waiting = activePlayers.filter(p => p.status === 'waiting')

    const totalCount = activePlayers.filter(p => {
      const status = getEffectiveCheckInStatus(p)
      return p.status === 'confirmed' && status !== 'no_show' && status !== 'pending'
    }).length
    const femaleCount = activePlayers.filter(p => {
      const g = String(p.gender || '').toLowerCase()
      const status = getEffectiveCheckInStatus(p)
      return (g === 'female' || g === 'nữ') && p.status === 'confirmed' && status !== 'no_show' && status !== 'pending'
    }).length
    const maleCount = totalCount - femaleCount
    const totalSkill = confirmed.reduce((acc, p) => acc + Number(p.pvna || 0), 0)
    const avgSkill = totalCount > 0 ? totalSkill / totalCount : 0


    const GroupLabel = ({ gender, count }: { gender: 'female' | 'male', count: number }) => {
      const isFemale = gender === 'female'
      return (
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          gap: 8, marginTop: 8, marginBottom: 6,
        }}>
          <View style={{
            width: 6, height: 6, borderRadius: 3,
            backgroundColor: isFemale ? '#D85A30' : '#0F6E56',
          }} />
          <Text style={{
            fontFamily: SCREEN_FONTS.label,
            fontSize: 11, fontWeight: '600',
            color: '#7A8884', letterSpacing: 0.3,
          }}>
            {isFemale ? 'NỮ' : 'NAM'}
          </Text>
          <View style={{ flex: 1, height: 0.5, backgroundColor: '#E5E3DC' }} />
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 10, color: '#B4B2A9' }}>{count} người</Text>
        </View>
      )
    }

    const handleManualStatusUpdate = async (player: ArrangementPlayer, newStatus: 'confirmed' | 'waiting' | 'remove') => {
      if (!sessionId) return

      // Safety check: Host cannot be removed
      if (player.id === hostId && newStatus === 'remove') {
        Alert.alert('Thông báo', 'Chủ kèo không thể bị loại bỏ khỏi danh sách.')
        return
      }

      const confirmMsg = newStatus === 'confirmed' 
        ? `Xác nhận ${player.name} tham gia chính thức?`
        : newStatus === 'waiting'
          ? `Chuyển ${player.name} xuống danh sách dự bị?`
          : `Gỡ ${player.name} khỏi danh sách tham gia?`

      if (Platform.OS !== 'web') {
        Alert.alert('Xác nhận', confirmMsg, [
          { text: 'Hủy', style: 'cancel' },
          { 
            text: 'Đồng ý', 
            style: newStatus === 'remove' ? 'destructive' : 'default',
            onPress: () => executeManualUpdate(player.id, newStatus) 
          }
        ])
      } else {
        if (window.confirm(confirmMsg)) {
          executeManualUpdate(player.id, newStatus)
        }
      }
    }

    const executeManualUpdate = async (playerId: string, newStatus: 'confirmed' | 'waiting' | 'remove') => {
      try {
        if (newStatus === 'remove') {
          const { error } = await supabase
            .from('session_players')
            .delete()
            .eq('session_id', sessionId)
            .eq('player_id', playerId)
          if (error) throw error
          setRemovedPlayerIds(prev => {
            const next = new Set(prev)
            next.add(playerId)
            return next
          })
        } else {
          const { data, error } = await supabase
            .from('session_players')
            .update({ status: newStatus, team_no: newStatus === 'waiting' ? null : undefined })
            .eq('session_id', sessionId)
            .eq('player_id', playerId)
            .select()
          
          if (data && data.length === 0 && playerId === hostId) {
            const { error: insertError } = await supabase
              .from('session_players')
              .insert({
                session_id: sessionId,
                player_id: playerId,
                status: newStatus,
                team_no: null
              })
            if (insertError) throw insertError
          } else if (error) {
            throw error
          }
        }
        onUpdated?.()
      } catch (err: any) {
        console.error('[ManualUpdate] Error:', err)
        Alert.alert('Lỗi', err.message || 'Không thể cập nhật trạng thái người chơi')
      }
    }

    const renderNewPlayerRow = (player: ArrangementPlayer, isReserve = false) => {
      const initials = getInitials(player.name || 'Người chơi')
      const gender = String(player.gender || '').toLowerCase()
      const isFemale = gender === 'female' || gender === 'nữ'
      const { bg, text } = getAvatarColor(player.name || '')
      const skillLevel = Number(player.pvna || 0)
      const checkInStatus = player.status === 'confirmed' ? getEffectiveCheckInStatus(player) : null
      const isHostPlayer = player.id === hostId

      return (
        <View key={player.id} style={{
          backgroundColor: isReserve ? '#FAFAF7' : 'white', 
          borderRadius: 12,
          borderWidth: isReserve ? 1 : 0.5, 
          borderColor: isReserve ? '#D5D2C8' : '#E5E3DC',
          borderStyle: isReserve ? 'dashed' : 'solid',
          padding: 10,
          paddingHorizontal: 12,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          marginBottom: 6,
          ...(!isReserve ? SHADOW.xs : {})
        }}>
          {/* Avatar */}
          <View style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: bg,
            alignItems: 'center', justifyContent: 'center',
            position: 'relative', flexShrink: 0,
          }}>
            <Text style={{
              fontFamily: SCREEN_FONTS.headline,
              fontSize: 14, color: text,
              fontWeight: '700'
            }}>{initials}</Text>

            {/* Gender dot */}
            <View style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 10, height: 10, borderRadius: 5,
              backgroundColor: isFemale ? '#D85A30' : '#0F6E56',
              borderWidth: 2, borderColor: 'white',
            }} />
          </View>

          {/* Info */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{
              fontSize: 13, fontWeight: '600', color: '#1A2E2A',
              marginBottom: 1, fontFamily: SCREEN_FONTS.label
            }} numberOfLines={1}>
              {player.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 11, color: '#7A8884', fontFamily: SCREEN_FONTS.label }}>
                {isFemale ? 'Nữ' : 'Nam'}
              </Text>

              {/* Preference Badges */}
              {player.metadata?.partner_gender_pref && player.metadata.partner_gender_pref !== 'any' && (
                <View style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  gap: 2, 
                  backgroundColor: player.metadata.partner_gender_pref === 'female' ? '#FAECE7' : '#E1F5EE', 
                  paddingHorizontal: 4, 
                  paddingVertical: 1,
                  borderRadius: 4,
                  borderWidth: 0.5,
                  borderColor: player.metadata.partner_gender_pref === 'female' ? '#993C1D30' : '#0F6E5630'
                }}>
                  <Text style={{ fontSize: 8 }}>🤝</Text>
                  <Text style={{ 
                    fontSize: 8, 
                    fontWeight: '800', 
                    color: player.metadata.partner_gender_pref === 'female' ? '#993C1D' : '#0F6E56',
                    fontFamily: SCREEN_FONTS.headline
                  }}>
                    {player.metadata.partner_gender_pref === 'male' ? 'NAM' : 'NỮ'}
                  </Text>
                </View>
              )}

              {player.metadata?.opponent_gender_pref && player.metadata.opponent_gender_pref !== 'any' && (
                <View style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  gap: 2, 
                  backgroundColor: player.metadata.opponent_gender_pref === 'female' ? '#FAECE7' : '#E1F5EE', 
                  paddingHorizontal: 4, 
                  paddingVertical: 1,
                  borderRadius: 4,
                  borderWidth: 0.5,
                  borderColor: player.metadata.opponent_gender_pref === 'female' ? '#993C1D30' : '#0F6E5630'
                }}>
                  <Text style={{ fontSize: 8 }}>⚔️</Text>
                  <Text style={{ 
                    fontSize: 8, 
                    fontWeight: '800', 
                    color: player.metadata.opponent_gender_pref === 'female' ? '#993C1D' : '#0F6E56',
                    fontFamily: SCREEN_FONTS.headline
                  }}>
                    {player.metadata.opponent_gender_pref === 'male' ? 'NAM' : 'NỮ'}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Management Actions */}
          {isEditMode && (
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
              <>
                {isReserve ? (
                  <TouchableOpacity 
                    onPress={() => handleManualStatusUpdate(player, 'confirmed')}
                    style={{
                      backgroundColor: '#E1F5EE',
                      paddingHorizontal: 8,
                      paddingVertical: 7,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: '#0F6E5630',
                      minWidth: 80,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#0F6E56', fontSize: 10, fontFamily: SCREEN_FONTS.headline, fontWeight: '700', lineHeight: 12 }}>XÁC NHẬN</Text>
                  </TouchableOpacity>
                ) : (
                  !isCheckInMode && (
                    <TouchableOpacity 
                      onPress={() => handleManualStatusUpdate(player, 'waiting')}
                      style={{
                        backgroundColor: '#FAECE7',
                        paddingHorizontal: 8,
                        paddingVertical: 7,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: '#D85A3030',
                        minWidth: 80,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: '#D85A30', fontSize: 10, fontFamily: SCREEN_FONTS.headline, fontWeight: '700', lineHeight: 12 }}>DỰ BỊ</Text>
                    </TouchableOpacity>
                  )
                )}

                {!isCheckInMode && !isHostPlayer && (
                  <TouchableOpacity 
                    onPress={() => handleManualStatusUpdate(player, 'remove')}
                    style={{
                      backgroundColor: '#fee2e2',
                      paddingHorizontal: 8,
                      paddingVertical: 7,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: '#dc262630',
                      minWidth: 80,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#dc2626', fontSize: 10, fontFamily: SCREEN_FONTS.headline, fontWeight: '700', lineHeight: 12 }}>LOẠI BỎ</Text>
                  </TouchableOpacity>
                )}
              </>
            </View>
          )}

          {/* Skill Level */}
          {!isEditMode && !isCheckInMode && (
            <View style={{ alignItems: 'flex-end', marginLeft: 'auto', minWidth: 40 }}>
              <Text style={{
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 16, color: isReserve ? '#B4B2A9' : '#1A2E2A', 
                fontWeight: '700',
                lineHeight: 16,
              }}>{skillLevel.toFixed(2)}</Text>
              <Text style={{
                fontSize: 9, color: '#B4B2A9', marginTop: 1,
                fontFamily: SCREEN_FONTS.label,
                fontWeight: '600'
              }}>TRÌNH ĐỘ</Text>
            </View>
          )}

          {/* Check-in Buttons (existing logic) */}
          {isCheckInMode && !isReserve && (
            <View style={{ flexDirection: 'row', gap: 6, marginLeft: 'auto' }}>
              <TouchableOpacity 
                onPress={() => handleCheckInUpdate(player.id, 'present')}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: checkInStatus === 'present' ? theme.primary : '#F5F5F0',
                  borderWidth: 1,
                  borderColor: checkInStatus === 'present' ? theme.primary : '#E5E3DC',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 95,
                  justifyContent: 'center'
                }}
              >
                <CheckCircle2 size={14} color={checkInStatus === 'present' ? theme.onPrimary : '#7A8884'} />
                <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: checkInStatus === 'present' ? theme.onPrimary : '#7A8884', fontWeight: '800' }}>CÓ MẶT</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={() => handleCheckInUpdate(player.id, 'pending')}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: checkInStatus === 'pending' || checkInStatus === 'no_show' ? '#FAEEDA' : '#F5F5F0',
                  borderWidth: 1,
                  borderColor: checkInStatus === 'pending' || checkInStatus === 'no_show' ? '#EF9F27' : '#E5E3DC',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 95,
                  justifyContent: 'center'
                }}
              >
                <XCircle size={14} color={checkInStatus === 'pending' || checkInStatus === 'no_show' ? '#854F0B' : '#7A8884'} />
                <Text style={{ fontSize: 11, fontFamily: SCREEN_FONTS.headline, color: checkInStatus === 'pending' || checkInStatus === 'no_show' ? '#854F0B' : '#7A8884', fontWeight: '800' }}>CHƯA TỚI</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )
    }

    const sortAndGroup = (playerList: ArrangementPlayer[]) => {
      const females = playerList.filter(p => {
        const g = String(p.gender || '').toLowerCase()
        return g === 'female' || g === 'nữ'
      }).sort((a, b) => Number(a.pvna || 0) - Number(b.pvna || 0))
      
      const males = playerList.filter(p => {
        const g = String(p.gender || '').toLowerCase()
        return !(g === 'female' || g === 'nữ')
      }).sort((a, b) => Number(a.pvna || 0) - Number(b.pvna || 0))

      return { females, males }
    }

    const renderSummaryAndList = (playerList: ArrangementPlayer[], isUnassigned = false) => {
      const { females, males } = sortAndGroup(playerList)
      
      return (
        <View style={{ marginTop: isUnassigned ? 12 : 0 }}>
          {females.length > 0 && (
            <>
              <GroupLabel gender="female" count={females.length} />
              {females.map(p => renderNewPlayerRow(p))}
            </>
          )}
          {males.length > 0 && (
            <>
              <GroupLabel gender="male" count={males.length} />
              {males.map(p => renderNewPlayerRow(p))}
            </>
          )}
        </View>
      )
    }

    const summaryStrip = (
      <View style={{
        backgroundColor: 'white', borderRadius: 12,
        borderWidth: 0.5, borderColor: '#E5E3DC',
        paddingVertical: 12, paddingHorizontal: 14,
        flexDirection: 'row', marginBottom: 4,
        ...SHADOW.xs
      }}>
        {[
          { num: totalCount, label: 'THAM GIA', color: '#1A2E2A' },
          { num: femaleCount, label: 'NỮ', color: '#D85A30' },
          { num: maleCount, label: 'NAM', color: '#0F6E56' },
          { num: avgSkill.toFixed(1), label: 'TB TRÌNH', color: '#1A2E2A' },
        ].map((item, i) => (
          <View key={i} style={{
            flex: 1, alignItems: 'center',
            borderLeftWidth: i > 0 ? 0.5 : 0,
            borderLeftColor: '#E5E3DC',
          }}>
            <View style={{ height: 24, justifyContent: 'flex-end', marginBottom: 2 }}>
              <Text style={{
                fontFamily: SCREEN_FONTS.headline,
                fontSize: 24,
                color: item.color, 
                lineHeight: 24,
                fontWeight: '900',
              }}>{item.num}</Text>
            </View>
            <Text style={{
              fontSize: 10, color: '#7A8884',
              fontWeight: '600', letterSpacing: 0.3,
              fontFamily: SCREEN_FONTS.label
            }}>{item.label}</Text>
          </View>
        ))}
      </View>
    )

    const reserveList = waiting.length > 0 && (
      <View style={{ marginTop: 12 }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          gap: 8, marginBottom: 8,
        }}>
          <Text style={{ fontSize: 14, color: '#854F0B' }}>•</Text>
          <Text style={{
            fontSize: 12, fontWeight: '700', color: '#EF9F27',
            fontFamily: SCREEN_FONTS.label
          }}>DANH SÁCH DỰ BỊ</Text>
          <View style={{
            backgroundColor: '#FAEEDA', paddingHorizontal: 7,
            paddingVertical: 2, borderRadius: 999,
          }}>
            <Text style={{
              fontSize: 10, fontWeight: '700', color: '#854F0B',
              fontFamily: SCREEN_FONTS.label
            }}>{waiting.length}</Text>
          </View>
        </View>

        {waiting.map(player => renderNewPlayerRow(player, true))}
      </View>
    )

    const noShowList = noShows.length > 0 && (
      <View style={{ marginTop: 12 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          gap: 8, marginBottom: 8,
        }}>
          <Text style={{ fontSize: 14, color: '#854F0B' }}>•</Text>
          <Text style={{
            fontSize: 12, fontWeight: '700', color: '#854F0B',
            fontFamily: SCREEN_FONTS.label
          }}>CHƯA TỚI</Text>
          <View style={{
            backgroundColor: '#FAEEDA', paddingHorizontal: 7,
            paddingVertical: 2, borderRadius: 999,
          }}>
            <Text style={{
              fontSize: 10, fontWeight: '700', color: '#854F0B',
              fontFamily: SCREEN_FONTS.label
            }}>{noShows.length}</Text>
          </View>
        </View>

        {noShows.map(player => renderNewPlayerRow(player, false))}
      </View>
    )

    const addButton = showAddButton && (
      <TouchableOpacity
        onPress={() => router.push(`/register/${sessionId}`)}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: theme.outlineVariant,
          borderStyle: 'dashed',
          backgroundColor: theme.surfaceContainerLowest,
          paddingHorizontal: 12,
          paddingVertical: 10,
          marginBottom: 6,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: RADIUS.full,
            backgroundColor: theme.surfaceVariant,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 10,
          }}
        >
          <PlusCircle size={16} color={theme.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 13, color: theme.primary }}>
            THÊM NGƯỜI CHƠI MỚI
          </Text>
          <Text style={{ fontFamily: SCREEN_FONTS.label, fontSize: 11, color: theme.onSurfaceVariant, opacity: 0.6, fontStyle: 'italic' }}>
            Nhấn để thêm khách trực tiếp vào kèo
          </Text>
        </View>
      </TouchableOpacity>
    )

    // Only show teams if check-in is complete AND we are not in manual override mode
    if (checkInCompleted && !showManualManagement) {
      const groups = confirmed.reduce((acc, p) => {
        const teamId = (p.team !== undefined && p.team !== null && p.team !== 0) ? String(p.team) : '0'
        if (!acc[teamId]) acc[teamId] = []
        acc[teamId].push(p)
        return acc
      }, {} as Record<string, ArrangementPlayer[]>)

      const teamKeys = Object.keys(groups)
        .filter(k => k !== '0' && groups[k].length > 0)
        .sort((a, b) => Number(a) - Number(b))
      const unassigned = groups['0'] || []

      return (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
            {teamKeys.map(teamId => {
              const teamPlayers = groups[teamId]
              const teamSkill = teamPlayers.reduce((acc, p) => acc + Number(p.pvna || 0), 0)
              const targetTeamSkill = teamPlayers.length * avgSkill
              const diff = teamSkill - targetTeamSkill
              
              const stripColor = '#0F6E56'

              return (
                <View key={teamId} style={{ 
                  width: '48.5%', // Slightly less than 50% to account for gap
                  backgroundColor: 'white', 
                  borderRadius: 14, 
                  borderWidth: 0.5, 
                  borderColor: '#E5E3DC',
                  overflow: 'hidden',
                  ...SHADOW.xs,
                }}>
                  {/* Team Strip */}
                  <View style={{ 
                    paddingHorizontal: 12, 
                    paddingVertical: 6,
                    backgroundColor: stripColor,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <Text style={{ 
                      fontFamily: SCREEN_FONTS.headline, 
                      fontSize: 11, 
                      color: 'white',
                      letterSpacing: 0.5,
                      fontWeight: '700'
                    }}>ĐỘI {teamId}</Text>
                  </View>
                  
                  {/* Card Body */}
                  <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
                    {/* ELO + Balance Row */}
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                      <Text style={{ 
                        fontFamily: SCREEN_FONTS.headline, 
                        fontSize: 28, 
                        color: '#1A2E2A',
                        lineHeight: 28,
                        fontWeight: '900'
                      }}>
                        {Number(teamSkill || 0).toFixed(2)}
                      </Text>
                      
                      <View style={{ 
                        backgroundColor: diff > 0 ? '#E1F5EE' : diff < 0 ? '#FAECE7' : '#F1EFE8', 
                        paddingHorizontal: 8, 
                        paddingVertical: 3, 
                        borderRadius: 999 
                      }}>
                        <Text style={{ 
                          fontSize: 10, 
                          color: diff > 0 ? '#0F6E56' : diff < 0 ? '#993C1D' : '#7A8884', 
                          fontWeight: '800',
                          fontFamily: SCREEN_FONTS.headline
                        }}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                        </Text>
                      </View>
                    </View>

                    <Text style={{ 
                      fontSize: 9, 
                      color: '#B4B2A9', 
                      fontFamily: SCREEN_FONTS.label,
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: 0.5
                    }}>TỔNG TRÌNH</Text>

                    {/* Players List */}
                    <View>
                      {teamPlayers.map((player, index) => {
                        const initials = getInitials(player.name || 'Người chơi')
                        const isMale = String(player.gender || '').toLowerCase() === 'male' || String(player.gender || '').toLowerCase() === 'nam'
                        
                        const colorSet = getAvatarColor(player.name || '')

                        return (
                          <View
                            key={player.id || index}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              paddingVertical: 8,
                              borderTopWidth: 0.5,
                              borderTopColor: '#F0EDE5',
                              gap: 8,
                            }}
                          >
                            <View style={{ position: 'relative' }}>
                              <View style={{
                                width: 30,
                                height: 30,
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 15,
                                backgroundColor: colorSet.bg,
                              }}>
                                <Text style={{ 
                                  fontSize: 12, 
                                  fontFamily: SCREEN_FONTS.headline, 
                                  color: colorSet.text, 
                                  fontWeight: '700' 
                                }}>{initials}</Text>
                              </View>
                              <View style={{ 
                                position: 'absolute',
                                bottom: -1,
                                right: -1,
                                width: 8, 
                                height: 8, 
                                borderRadius: 4, 
                                backgroundColor: isMale ? '#0F6E56' : '#D85A30',
                                borderWidth: 1.5,
                                borderColor: 'white',
                              }} />
                            </View>

                            <View style={{ flex: 1, justifyContent: 'center' }}>
                              <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: SCREEN_FONTS.label, fontWeight: '600', color: '#1A2E2A' }}>
                                {player.name || 'Người chơi'}
                              </Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                                <Text style={{ fontSize: 10, fontFamily: SCREEN_FONTS.label, color: '#7A8884' }}>
                                  {isMale ? 'Nam' : 'Nữ'} · {Number(player.pvna || 0).toFixed(2)}
                                </Text>
                                {player.metadata?.partner_gender_pref && player.metadata.partner_gender_pref !== 'any' && (
                                  <View style={{ 
                                    flexDirection: 'row', 
                                    alignItems: 'center', 
                                    gap: 2, 
                                    backgroundColor: player.metadata.partner_gender_pref === 'female' ? '#FAECE7' : '#E1F5EE', 
                                    paddingHorizontal: 4, 
                                    paddingVertical: 1,
                                    borderRadius: 4,
                                    borderWidth: 0.5,
                                    borderColor: player.metadata.partner_gender_pref === 'female' ? '#993C1D30' : '#0F6E5630'
                                  }}>
                                    <Text style={{ fontSize: 8 }}>🤝</Text>
                                    <Text style={{ 
                                      fontSize: 8, 
                                      fontWeight: '800', 
                                      color: player.metadata.partner_gender_pref === 'female' ? '#993C1D' : '#0F6E56',
                                      fontFamily: SCREEN_FONTS.headline
                                    }}>
                                      {player.metadata.partner_gender_pref === 'male' ? 'NAM' : 'NỮ'}
                                    </Text>
                                  </View>
                                )}
                                {player.metadata?.opponent_gender_pref && player.metadata.opponent_gender_pref !== 'any' && (
                                  <View style={{ 
                                    flexDirection: 'row', 
                                    alignItems: 'center', 
                                    gap: 2, 
                                    backgroundColor: player.metadata.opponent_gender_pref === 'female' ? '#FAECE7' : '#E1F5EE', 
                                    paddingHorizontal: 4, 
                                    paddingVertical: 1,
                                    borderRadius: 4,
                                    borderWidth: 0.5,
                                    borderColor: player.metadata.opponent_gender_pref === 'female' ? '#993C1D30' : '#0F6E5630'
                                  }}>
                                    <Text style={{ fontSize: 8 }}>⚔️</Text>
                                    <Text style={{ 
                                      fontSize: 8, 
                                      fontWeight: '800', 
                                      color: player.metadata.opponent_gender_pref === 'female' ? '#993C1D' : '#0F6E56',
                                      fontFamily: SCREEN_FONTS.headline
                                    }}>
                                      {player.metadata.opponent_gender_pref === 'male' ? 'NAM' : 'NỮ'}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            </View>
                          </View>
                        )
                      })}
                    </View>
                  </View>
                </View>
              )
            })}
          </View>

          {/* Legend */}
          <View style={{
            backgroundColor: 'white',
            borderRadius: 10, 
            borderWidth: 0.5, 
            borderColor: '#E5E3DC',
            paddingHorizontal: 14,
            paddingVertical: 10,
            flexDirection: 'row', 
            alignItems: 'center', 
            gap: 16,
            marginTop: 10,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#D85A30' }} />
              <Text style={{ fontSize: 11, color: '#7A8884', fontFamily: SCREEN_FONTS.label }}>Nữ</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#0F6E56' }} />
              <Text style={{ fontSize: 11, color: '#7A8884', fontFamily: SCREEN_FONTS.label }}>Nam</Text>
            </View>
            <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ backgroundColor: '#E1F5EE', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#0F6E56', fontFamily: SCREEN_FONTS.headline }}>
                  {avgSkill.toFixed(2)}
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: '#7A8884', fontFamily: SCREEN_FONTS.label }}>Trình trung bình</Text>
            </View>
          </View>

          {unassigned.length > 0 && (
            <View style={{ marginTop: 24 }}>
              {renderSummaryAndList(unassigned, true)}
            </View>
          )}

          {reserveList}
          {noShowList}
          {addButton}
        </>
      )
    }

    // Default view: Show flat list of confirmed players and waitlist
    return (
      <View>
        {summaryStrip}
        {renderSummaryAndList(confirmed)}
        {reserveList}
        {noShowList}
        {addButton}
      </View>
    )
  }

  const handleCheckInUpdate = async (playerId: string, status: 'present' | 'no_show' | 'pending') => {
    if (!sessionId) return
    console.log('[CheckIn] Updating player:', playerId, 'to:', status)
    
    // Immediate local feedback
    setLocalStatuses(prev => {
      const next = { ...prev, [playerId]: status }
      console.log('[CheckIn] Local statuses:', next)
      return next
    })

    try {
      const { error } = await supabase
        .from('session_players')
        .update({ check_in_status: status })
        .eq('session_id', sessionId)
        .eq('player_id', playerId)
      
      if (error) throw error
      onUpdated?.()
    } catch (err) {
      console.error('[CheckInUpdate] Error:', err)
    }
  }

  return (
    <View style={{ marginTop: 24 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ backgroundColor: theme.primary + '15', padding: 8, borderRadius: 12 }}>
            <Users size={20} color={theme.primary} />
          </View>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 20, color: theme.onBackground, textTransform: 'uppercase' }}>
            {checkInCompleted && !showManualManagement ? 'Danh sách đội' : 'Danh sách người chơi'}
          </Text>
        </View>

        {/* Header Actions */}
        {isHost && !isAfterEnd && !['done', 'pending_completion', 'pending_results', 'completed', 'finished', 'archived', 'cancelled_no_players', 'failed_to_fill', 'cancelled'].includes(sessionStatus) && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {checkInCompleted && (
              <TouchableOpacity 
                onPress={() => {
                  setShowManualManagement(!showManualManagement)
                  if (isEditMode) setIsEditMode(false)
                }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: showManualManagement ? theme.primary : '#F5F5F0',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: showManualManagement ? theme.primary : '#E5E3DC',
                }}
              >
                <Settings2 size={18} color={showManualManagement ? theme.onPrimary : '#7A8884'} />
              </TouchableOpacity>
            )}

            {!isCheckInMode && (!checkInCompleted || showManualManagement) && (
              <TouchableOpacity 
                onPress={() => setIsEditMode(!isEditMode)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: isEditMode ? theme.primary : theme.primary + '10',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: theme.primary + '20',
                }}
              >
                {isEditMode ? (
                  <Check size={18} color={theme.onPrimary} />
                ) : (
                  <Pencil size={18} color={theme.primary} />
                )}
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <View style={{ gap: 16 }}>
        {renderContent()}

        {!hideEmptySlots && spotsLeft > 0 && (
          <EmptySlot count={spotsLeft} sessionId={sessionId} startTime={startTime} isHost={isHost} sessionStatus={sessionStatus} isAfterEnd={isAfterEnd} />
        )}
      </View>
    </View>
  )
}
