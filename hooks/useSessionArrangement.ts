import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppDialogConfig } from '@/components/design'
import type { SessionDetailRecord } from '@/hooks/useSessionDetail'
import { type ArrangementPlayer, autoBalance, buildArrangementPlayers } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'

export function useSessionArrangement(
  session: SessionDetailRecord | null,
  isHost: boolean,
  refreshSession: () => Promise<void>,
  presentDialog?: (config: AppDialogConfig) => void,
) {
  const [savingArrangement, setSavingArrangement] = useState(false)
  const [isArranging, setIsArranging] = useState(false)
  const [arrangedPlayers, setArrangedPlayers] = useState<ArrangementPlayer[]>([])
  const [savedTeams, setSavedTeams] = useState<Record<string, 1 | 2>>({})

  useEffect(() => {
    if (!session) {
      setArrangedPlayers([])
      setSavedTeams({})
      return
    }

    const nextArrangement = buildArrangementPlayers(session)
    setArrangedPlayers(nextArrangement)
    setSavedTeams(Object.fromEntries(nextArrangement.map((player) => [player.id, player.team])) as Record<string, 1 | 2>)
  }, [session])

  const switchTeam = useCallback((playerId: string) => {
    setArrangedPlayers((current) =>
      current.map((player) =>
        player.id === playerId
          ? { ...player, team: player.team === 1 ? 2 : 1 }
          : player,
      ),
    )
  }, [])

  const onAutoBalance = useCallback(() => {
    setArrangedPlayers((current) => autoBalance(current))
  }, [])

  const onSaveArrangement = useCallback(async () => {
    if (!session || !isHost) return

    const expectedPerTeam = session.max_players / 2
    if (teamA.length > expectedPerTeam || teamB.length > expectedPerTeam) {
      presentDialog?.({
        title: 'Đội hình không hợp lệ',
        message: `Mỗi đội chỉ được phép có tối đa ${expectedPerTeam} người cho kèo ${session.max_players === 4 ? 'đánh đôi' : 'đánh đơn'}.`,
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    setSavingArrangement(true)

    const { error } = await supabase.rpc('save_session_teams', {
      p_session_id: session.id,
      p_assignments: arrangedPlayers.map((player) => ({
        player_id: player.id,
        team_no: player.team,
      })),
    })

    setSavingArrangement(false)

    if (error) {
      presentDialog?.({
        title: 'Không lưu được đội',
        message: error.message,
        actions: [{ label: 'Đã hiểu' }],
      })
      return
    }

    const nextSavedTeams = Object.fromEntries(arrangedPlayers.map((player) => [player.id, player.team])) as Record<string, 1 | 2>
    setSavedTeams(nextSavedTeams)
    setIsArranging(false)
    presentDialog?.({
      title: 'Đã lưu thay đổi',
      message: 'Đội hình đã được cập nhật.',
      actions: [{ label: 'Đã hiểu' }],
    })
    await refreshSession()
  }, [arrangedPlayers, isHost, refreshSession, session, teamA, teamB])

  const teamA = useMemo(
    () => arrangedPlayers.filter((player) => player.team === 1),
    [arrangedPlayers],
  )
  const teamB = useMemo(
    () => arrangedPlayers.filter((player) => player.team === 2),
    [arrangedPlayers],
  )
  const averageTeamA = teamA.length ? Math.round(teamA.reduce((sum, player) => sum + player.elo, 0) / teamA.length) : 0
  const averageTeamB = teamB.length ? Math.round(teamB.reduce((sum, player) => sum + player.elo, 0) / teamB.length) : 0
  const arrangementDirty = arrangedPlayers.some((player) => savedTeams[player.id] !== player.team)

  return {
    savingArrangement,
    isArranging,
    setIsArranging,
    arrangedPlayers,
    switchTeam,
    onAutoBalance,
    onSaveArrangement,
    teamA,
    teamB,
    averageTeamA,
    averageTeamB,
    arrangementDirty,
  }
}
