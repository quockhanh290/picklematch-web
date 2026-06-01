const fs = require('fs')
const path = require('path')

// 1. RosterScreen.tsx
const rosterPath = path.resolve('features/host/session-detail/RosterScreen.tsx')
let rosterContent = fs.readFileSync(rosterPath, 'utf8')

rosterContent = rosterContent.replace(`import { refreshBus } from './next-round-v2/refreshBus'`, `import { useQueryClient } from '@tanstack/react-query'
import { liveSessionQueryKeys, useLiveSessionQuery } from './next-round-v2/queries'
import type { LiveRows } from './next-round-v2/types'`)
rosterContent = rosterContent.replace(`import { useLiveRows } from './next-round-v2/useLiveRows'`, ``)

const oldHookCall = `const { rows, applyLiveStateVersion, patchPlayerRow, settlePlayerPatch, clearPlayerPatch, loadLiveState, loading, refreshing } = useLiveRows(sessionId, playersById)`
const newHookCall = `const queryClient = useQueryClient()
  const { data: rowsData, isLoading: loading } = useLiveSessionQuery(sessionId, playersById)
  const rows = rowsData || { playerRows: [], pairRows: [], roundRows: [], liveMatchRows: [], liveStateVersion: null }
  const refreshing = loading
  const loadLiveState = useCallback(async () => { await queryClient.invalidateQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) }) }, [queryClient, sessionId])
  const applyLiveStateVersion = useCallback((version) => { queryClient.invalidateQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) }) }, [queryClient, sessionId])
  const patchPlayerRow = useCallback((playerId, patch) => {
    queryClient.setQueryData(liveSessionQueryKeys.detail(sessionId), old => {
      if (!old) return old
      return { ...old, playerRows: old.playerRows.map(r => r.player_id === playerId ? { ...r, ...patch } : r) }
    })
  }, [queryClient, sessionId])
  const settlePlayerPatch = useCallback(() => {}, [])
  const clearPlayerPatch = useCallback(() => { queryClient.invalidateQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) }) }, [queryClient, sessionId])`

rosterContent = rosterContent.replace(oldHookCall, newHookCall)
rosterContent = rosterContent.replace(/refreshBus\.emit\(\)/g, `queryClient.invalidateQueries({ queryKey: liveSessionQueryKeys.detail(sessionId) })`)
fs.writeFileSync(rosterPath, rosterContent)

// 2. ScreenComponents.tsx
const componentsPath = path.resolve('features/host/session-detail/next-round-v2/components/ScreenComponents.tsx')
let componentsContent = fs.readFileSync(componentsPath, 'utf8')
componentsContent = componentsContent.replace(`import { refreshBus } from '../refreshBus'\n`, ``)
fs.writeFileSync(componentsPath, componentsContent)

console.log("Refactored RosterScreen and ScreenComponents")
