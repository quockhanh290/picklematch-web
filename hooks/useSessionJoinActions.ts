import { router } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'

import type { RequestStatus, SessionDetailRecord, ViewerPlayer } from '@/hooks/useSessionDetail'
import { getMatchStatus, type MatchStatus } from '@/lib/matchmaking'
import { getComparableElo } from '@/lib/sessionDetail'
import { supabase } from '@/lib/supabase'
import { STRINGS } from '@/constants/strings'

type DialogAction = {
  label: string
  tone?: 'primary' | 'secondary' | 'danger'
  onPress?: () => void | Promise<void>
}

type Params = {
  session: SessionDetailRecord | null
  userId?: string | null
  viewerPlayer: ViewerPlayer | null
  hasJoined: boolean
  requestStatus: RequestStatus
  setRequestStatus: (status: RequestStatus) => void
  setHostResponseTemplate: (value: string | null) => void
  introNote: string
  onJoinModalClose: () => void
  onJoinModalOpen: () => void
  refreshSession: () => Promise<void>
  presentDialog: (payload: { title: string; message: string; actions: DialogAction[] }) => void
}

export function useSessionJoinActions({
  session,
  userId,
  viewerPlayer,
  hasJoined,
  requestStatus,
  setRequestStatus,
  setHostResponseTemplate,
  introNote,
  onJoinModalClose,
  onJoinModalOpen,
  refreshSession,
  presentDialog,
}: Params) {
  const [joining, setJoining] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const isHost = userId != null && userId === session?.host.id
  const viewerElo = getComparableElo(viewerPlayer)
  const playerCount = session?.session_players.length ?? 0
  const maxPlayers = session?.max_players ?? 0
  const eloMin = session?.elo_min ?? 0

  const matchStatus: MatchStatus = useMemo(
    () => getMatchStatus(viewerElo, eloMin, playerCount, maxPlayers),
    [eloMin, maxPlayers, playerCount, viewerElo],
  )

  const hostRequiresApproval = Boolean(session?.require_approval)
  const isJoinWindowOpen = useMemo(() => {
    if (session?.status !== 'open' && session?.status !== 'full') return false
    if (!session?.fill_deadline) return true
    const deadlineMs = Date.parse(session.fill_deadline)
    if (Number.isNaN(deadlineMs)) return true
    return deadlineMs > Date.now()
  }, [session?.fill_deadline, session?.status])

  const canShowJoinActions = !isHost && !hasJoined && isJoinWindowOpen

  const directJoinSession = useCallback(async () => {
    if (!userId) {
      presentDialog({
        title: STRINGS.session_join.dialogs.login_required.title,
        message: STRINGS.session_join.dialogs.login_required.message,
        actions: [
          { label: STRINGS.common.later, tone: 'secondary' },
          { label: STRINGS.common.login, onPress: () => router.push('/login') },
        ],
      })
      return
    }

    if (!session) return
    if (!isJoinWindowOpen) {
      presentDialog({
        title: STRINGS.session_join.dialogs.deadline_passed.title,
        message: STRINGS.session_join.dialogs.deadline_passed.message,
        actions: [{ label: STRINGS.common.got_it }],
      })
      return
    }

    setJoining(true)
    const { error } = await supabase.rpc('join_session', {
      p_session_id: session.id,
    })

    setJoining(false)

    if (error) {
      presentDialog({
        title: STRINGS.session_join.dialogs.join_failed.title,
        message: error.message,
        actions: [{ label: STRINGS.common.close, tone: 'secondary' }],
      })
      return
    }

    setRequestStatus('accepted')
    onJoinModalClose()
    presentDialog({
      title: STRINGS.session_join.dialogs.join_success.title,
      message: STRINGS.session_join.dialogs.join_success.message,
      actions: [{ label: STRINGS.common.great }],
    })
    await refreshSession()
  }, [isJoinWindowOpen, onJoinModalClose, presentDialog, refreshSession, session, setRequestStatus, userId])

  const sendJoinRequest = useCallback(async () => {
    if (!userId) {
      presentDialog({
        title: STRINGS.session_join.dialogs.login_required.title,
        message: STRINGS.session_join.dialogs.login_required_request,
        actions: [
          { label: STRINGS.common.later, tone: 'secondary' },
          { label: STRINGS.common.login, onPress: () => router.push('/login') },
        ],
      })
      return
    }

    if (!session) return
    if (!isJoinWindowOpen) {
      presentDialog({
        title: STRINGS.session_join.dialogs.deadline_passed.title,
        message: STRINGS.session_join.dialogs.deadline_passed.message,
        actions: [{ label: STRINGS.common.got_it }],
      })
      return
    }

    setRequesting(true)
    const { error } = await supabase.from('join_requests').upsert(
      {
        match_id: session.id,
        player_id: userId,
        status: 'pending',
        intro_note: introNote.trim() || null,
      },
      { onConflict: 'match_id,player_id' },
    )
    setRequesting(false)

    if (error) {
      presentDialog({
        title: STRINGS.session_join.dialogs.request_failed.title,
        message: error.message,
        actions: [{ label: STRINGS.common.close, tone: 'secondary' }],
      })
      return
    }

    setRequestStatus('pending')
    setHostResponseTemplate(null)
    onJoinModalClose()
    presentDialog({
      title: matchStatus === 'WAITLIST' ? STRINGS.session_join.dialogs.waitlist_success.title : STRINGS.session_join.dialogs.request_success.title,
      message:
        matchStatus === 'WAITLIST'
          ? STRINGS.session_join.dialogs.waitlist_success.message
          : STRINGS.session_join.dialogs.request_success.message,
      actions: [{ label: STRINGS.common.got_it }],
    })
    await refreshSession()
  }, [introNote, isJoinWindowOpen, matchStatus, onJoinModalClose, presentDialog, refreshSession, session, setHostResponseTemplate, setRequestStatus, userId])

  const leaveSession = useCallback(async () => {
    if (!session || !userId) return

    const hostFlow = isHost
    const title = hostFlow ? STRINGS.session_join.dialogs.cancel_session.title : STRINGS.session_join.dialogs.leave_session.title
    const message = hostFlow
      ? STRINGS.session_join.dialogs.cancel_session.message
      : STRINGS.session_join.dialogs.leave_session.message
    const destructiveText = hostFlow ? STRINGS.session_join.dialogs.cancel_session.confirm : STRINGS.session_join.dialogs.leave_session.confirm

    presentDialog({
      title,
      message,
      actions: [
        { label: STRINGS.common.stay, tone: 'secondary' },
        {
          label: destructiveText,
          tone: 'danger',
          onPress: async () => {
            setLeaving(true)
            const { error } = hostFlow
              ? await supabase.rpc('cancel_host_session', { p_session_id: session.id })
              : await supabase
                  .from('session_players')
                  .delete()
                  .eq('session_id', session.id)
                  .eq('player_id', userId)

            setLeaving(false)

            if (error) {
              presentDialog({
                title: hostFlow ? STRINGS.session_join.dialogs.cancel_failed.title : STRINGS.session_join.dialogs.leave_failed.title,
                message: error.message,
                actions: [{ label: STRINGS.common.close, tone: 'secondary' }],
              })
              return
            }

            await refreshSession()
          },
        },
      ],
    })
  }, [isHost, presentDialog, refreshSession, session, userId])

  const cancelJoinRequest = useCallback(async () => {
    if (!session || !userId) return

    presentDialog({
      title: STRINGS.session_join.dialogs.cancel_request.title,
      message: STRINGS.session_join.dialogs.cancel_request.message,
      actions: [
        { label: STRINGS.common.keep, tone: 'secondary' },
        {
          label: STRINGS.session_join.dialogs.cancel_request.confirm,
          tone: 'danger',
          onPress: async () => {
            setRequesting(true)
            const { error } = await supabase
              .from('join_requests')
              .delete()
              .eq('match_id', session.id)
              .eq('player_id', userId)
            setRequesting(false)

            if (error) {
              presentDialog({
                title: STRINGS.common.error,
                message: STRINGS.session_join.errors.cancel_request_failed + error.message,
                actions: [{ label: STRINGS.common.close, tone: 'secondary' }],
              })
              return
            }

            setRequestStatus('none')
            await refreshSession()
          },
        },
      ],
    })
  }, [presentDialog, refreshSession, session, setRequestStatus, userId])

  function handleSmartJoinPress() {
    // 1. If host requires approval, always open request modal
    if (hostRequiresApproval) {
      onJoinModalOpen()
      return
    }

    // 2. If it's waitlist mode, show informative dialog instead of modal
    if (matchStatus === 'WAITLIST') {
      presentDialog({
        title: STRINGS.session_join.dialogs.waitlist_confirm.title,
        message: STRINGS.session_join.dialogs.waitlist_confirm.message,
        actions: [
          { label: STRINGS.session_join.dialogs.waitlist_confirm.cancel, tone: 'secondary' },
          { 
            label: STRINGS.session_join.dialogs.waitlist_confirm.confirm, 
            tone: 'primary', 
            onPress: () => {
              void sendJoinRequest()
            } 
          }
        ]
      })
      return
    }

    // 3. Check skill difference for warning (0.2 PVNA = 200 Elo)
    const skillDiff = eloMin - viewerElo
    if (skillDiff > 200) {
      presentDialog({
        title: STRINGS.session_join.dialogs.skill_warning.title,
        message: STRINGS.session_join.dialogs.skill_warning.message.replace('{diff}', (skillDiff / 1000).toFixed(1)),
        actions: [
          { label: STRINGS.session_join.dialogs.skill_warning.cancel, tone: 'secondary' },
          { label: STRINGS.session_join.dialogs.skill_warning.confirm, tone: 'primary', onPress: () => void directJoinSession() }
        ]
      })
      return
    }

    // 4. Join immediately if no approval required and skill is okay (or slightly lower but < 0.2)
    void directJoinSession()
  }

  return {
    joining,
    requesting,
    leaving,
    matchStatus,
    hostRequiresApproval,
    canShowJoinActions,
    requestStatus,
    directJoinSession,
    sendJoinRequest,
    cancelJoinRequest,
    leaveSession,
    handleSmartJoinPress,
  }
}
