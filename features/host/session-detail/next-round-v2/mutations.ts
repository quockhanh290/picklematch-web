import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { liveSessionQueryKeys } from './queries'
import type { LiveRows } from './types'
import type { SessionPlayerStateRow } from '@/lib/next-round-suggester/types'
import { checkInLiveSessionPlayers, checkOutLiveSessionPlayers, startPersistedLiveMatch } from './api'

export function useCheckInMutation(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['liveSession', sessionId],
    mutationFn: async ({ playerIds }: { playerIds: string[]; optimisticRows: SessionPlayerStateRow[] }) => {
      return checkInLiveSessionPlayers(sessionId, playerIds)
    },
    onMutate: async ({ optimisticRows }) => {
      await queryClient.cancelQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) })
      const previousState = queryClient.getQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId))
      if (previousState) {
        queryClient.setQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId), {
          ...previousState,
          playerRows: [...previousState.playerRows, ...optimisticRows],
        })
      }
      return { previousState }
    },
    onError: (err, variables, context) => {
      if (context?.previousState) {
        queryClient.setQueryData(liveSessionQueryKeys.detail(sessionId), context.previousState)
      }
    },
  })
}

export function useCheckOutMutation(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['liveSession', sessionId],
    mutationFn: async ({ playerIds }: { playerIds: string[] }) => {
      return checkOutLiveSessionPlayers(sessionId, playerIds)
    },
    onMutate: async ({ playerIds }) => {
      await queryClient.cancelQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) })
      const previousState = queryClient.getQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId))
      if (previousState) {
        const idSet = new Set(playerIds)
        queryClient.setQueryData<LiveRows>(liveSessionQueryKeys.detail(sessionId), {
          ...previousState,
          playerRows: previousState.playerRows.map(row =>
            idSet.has(row.player_id) ? { ...row, checked_out_at: new Date().toISOString() } : row
          ),
        })
      }
      return { previousState }
    },
    onError: (err, variables, context) => {
      if (context?.previousState) {
        queryClient.setQueryData(liveSessionQueryKeys.detail(sessionId), context.previousState)
      }
    },
  })
}

// onMutate only cancels any in-flight poll (no optimistic update — screen manages its own
// optimistic state via optimisticLiveMatches + setStartedPreviewIds).
// onError omitted: screen catch block handles cleanup; no cache state to roll back.
export function useStartMatchMutation(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['liveSession', sessionId],
    mutationFn: async ({ rpcPayload, edgePayload }: { rpcPayload?: any; edgePayload?: any }) => {
      if (edgePayload) {
        return startPersistedLiveMatch(sessionId, edgePayload)
      }
      const { data, error } = await supabase.rpc('start_live_session_match_from_payload_versioned', rpcPayload)
      if (error) throw error
      return data
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) })
    },
  })
}

export function useCompleteMatchMutation(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['liveSession', sessionId],
    mutationFn: async ({ rpcPayload }: { rpcPayload: any }) => {
      const { data, error } = await supabase.rpc('complete_live_session_match_versioned', rpcPayload)
      if (error) throw error
      return data
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) })
    },
  })
}
