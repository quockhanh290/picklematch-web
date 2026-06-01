import fs from 'fs'
import path from 'path'

const modelPath = path.resolve('features/host/session-detail/next-round-v2/useNextRoundModel.ts')
const screenPath = path.resolve('features/host/session-detail/NextRoundSuggesterScreenV2.tsx')

let modelContent = fs.readFileSync(modelPath, 'utf8')
let screenContent = fs.readFileSync(screenPath, 'utf8')

// 1. Update useNextRoundModel.ts
modelContent = modelContent.replace(`import { useLiveRows } from './useLiveRows'`, `import { useLiveSessionQuery } from './queries'`)
modelContent = modelContent.replace(`const liveRows = useLiveRows(sessionId, playersById)\n  const deferredRows = useDeferredValue(liveRows.rows)`, `const { data: rowsData, isLoading: loading, error: queryError } = useLiveSessionQuery(sessionId, playersById)
  const rows = rowsData || { playerRows: [], pairRows: [], roundRows: [], liveMatchRows: [], liveStateVersion: null }
  const liveRows = { rows, loading, error: queryError ? queryError.message : null, lastLoadStateMsRef: { current: null }, refreshing: loading }
  const deferredRows = useDeferredValue(rows)`)

modelContent = modelContent.replace(/reconcileExpectedLiveState: liveRows\.reconcileExpectedLiveState,\n\s*/g, '')
modelContent = modelContent.replace(/refreshStatus: liveRows\.refreshStatus,\n\s*/g, '')
modelContent = modelContent.replace(/optimisticUpdatePlayerPatch: liveRows\.optimisticUpdatePlayerPatch,\n\s*/g, '')
modelContent = modelContent.replace(/addPlayerRow: liveRows\.addPlayerRow,\n\s*/g, '')
modelContent = modelContent.replace(/clearPlayerPatch: liveRows\.clearPlayerPatch,\n\s*/g, '')
modelContent = modelContent.replace(/clearPlayerRow: liveRows\.clearPlayerRow,\n\s*/g, '')
modelContent = modelContent.replace(/patchPlayerRow: liveRows\.patchPlayerRow,\n\s*/g, '')
modelContent = modelContent.replace(/settlePlayerPatch: liveRows\.settlePlayerPatch,\n\s*/g, '')
modelContent = modelContent.replace(/settlePlayerRow: liveRows\.settlePlayerRow,\n\s*/g, '')
modelContent = modelContent.replace(/reloadLiveState: liveRows\.loadLiveState,\n\s*/g, '')
modelContent = modelContent.replace(/loadLiveState: liveRows\.loadLiveState,\n\s*/g, 'loadLiveState: async () => {},\n    ')
modelContent = modelContent.replace(/setError: liveRows\.setError,\n\s*/g, 'setError: () => {},\n    ')

fs.writeFileSync(modelPath, modelContent)

// 2. Update NextRoundSuggesterScreenV2.tsx
screenContent = screenContent.replace(`import { refreshBus } from './next-round-v2/refreshBus'`, `import { useCheckInMutation, useCheckOutMutation, useUpdateScoreMutation, useStartMatchMutation, useCompleteMatchMutation, useEndActiveRoundMutation } from './next-round-v2/mutations'`)

// Remove destructured props that no longer exist
screenContent = screenContent.replace(/addPlayerRow,\n\s*/g, '')
screenContent = screenContent.replace(/clearPlayerRow,\n\s*/g, '')
screenContent = screenContent.replace(/optimisticUpdatePlayerPatch,\n\s*/g, '')
screenContent = screenContent.replace(/settlePlayerPatch,\n\s*/g, '')
screenContent = screenContent.replace(/clearPlayerPatch,\n\s*/g, '')
screenContent = screenContent.replace(/settlePlayerRow,\n\s*/g, '')
screenContent = screenContent.replace(/reconcileExpectedLiveState,\n\s*/g, '')
screenContent = screenContent.replace(/refreshStatus,\n\s*/g, '')

// Insert mutation hooks
screenContent = screenContent.replace(`const {`, `const checkInMutation = useCheckInMutation(sessionId)
  const checkOutMutation = useCheckOutMutation(sessionId)
  const startMatchMutation = useStartMatchMutation(sessionId)
  const completeMatchMutation = useCompleteMatchMutation(sessionId)
  const endActiveRoundMutation = useEndActiveRoundMutation(sessionId)
  const updateScoreMutation = useUpdateScoreMutation(sessionId)

  const {`)

// Replace check in logic
screenContent = screenContent.replace(/addPlayerRow\(optimisticRow\)\n\s*try \{\n\s*const checkinPayload = await checkInLiveSessionPlayers\(sessionId, \[playerId\]\)\n\s*applyLiveStateVersion\(checkinPayload\?\.live_state_version\)\n\s*settlePlayerRow\(playerId, optimisticRow\)/g, `try {
      await checkInMutation.mutateAsync({ playerIds: [playerId], optimisticRows: [optimisticRow] })`)

screenContent = screenContent.replace(/clearPlayerRow\(playerId\)/g, '')

// Replace check out logic
screenContent = screenContent.replace(/optimisticUpdatePlayerPatch\(playerId, \{ checked_out_at: new Date\(\)\.toISOString\(\) \}\)\n\s*try \{\n\s*const checkoutPayload = await checkOutLiveSessionPlayers\(sessionId, \[playerId\]\)\n\s*applyLiveStateVersion\(checkoutPayload\?\.live_state_version\)\n\s*settlePlayerPatch\(playerId, \{ checked_out_at: checkoutPayload\?\.players\?\.\[0\]\?\.checked_out_at ?? new Date\(\)\.toISOString\(\) \}\)/g, `try {
      await checkOutMutation.mutateAsync({ playerIds: [playerId] })`)

screenContent = screenContent.replace(/clearPlayerPatch\(playerId\)/g, '')

// Remove scheduleReconcile and reconcileTimeouts logic
screenContent = screenContent.replace(/const scheduleReconcile = \(result/g, `const scheduleReconcile = () => {} // Removed\n  const __ignore = (result`)

// Remove refreshBus logic
screenContent = screenContent.replace(/React\.useEffect\(\(\) => \{\n\s*const unsub = refreshBus\.subscribe\(\(\) => loadLiveState\(\)\)\n\s*return unsub\n\s*\}, \[loadLiveState\]\)/g, '')

fs.writeFileSync(screenPath, screenContent)

console.log("Refactored NextRoundSuggesterScreenV2.tsx and useNextRoundModel.ts")
