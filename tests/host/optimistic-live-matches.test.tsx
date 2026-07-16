import React, { useEffect, useState } from 'react'
import { renderHook, waitFor } from '@testing-library/react-native'

import {
  mergeRowsById,
  pruneOptimisticLiveMatchesByServerId,
  withoutRowsById,
} from '@/features/host/session-detail/next-round-v2/optimisticLiveMatches'

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

type MatchRow = {
  id: string
  court_idx: number
  status: 'suggested' | 'live' | 'completed'
}

const optimisticRow: MatchRow = {
  id: 'optimistic-match-1',
  court_idx: 0,
  status: 'live',
}

function useOptimisticCleanupHarness(serverRows: MatchRow[]) {
  const [optimisticRows, setOptimisticRows] = useState<MatchRow[]>(() => [optimisticRow])

  useEffect(() => {
    setOptimisticRows(current => pruneOptimisticLiveMatchesByServerId(current, serverRows))
  }, [serverRows])

  return optimisticRows
}

describe('optimistic live match cleanup', () => {
  it('compacts null rows while merging a committed match', () => {
    expect(mergeRowsById(
      [{ id: 'old', status: 'suggested' }, null],
      [{ id: 'old', status: 'live' }, undefined],
    )).toEqual([{ id: 'old', status: 'live' }])
  })

  it('removes ids and malformed rows from stale client projections', () => {
    expect(withoutRowsById(
      [{ id: 'keep' }, null, { id: 'remove' }],
      new Set(['remove']),
    )).toEqual([{ id: 'keep' }])
  })

  it('removes the optimistic entry once the server returns the same match id', async () => {
    const { result, rerender } = renderHook(
      ({ serverRows }: { serverRows: MatchRow[] }) => useOptimisticCleanupHarness(serverRows),
      { initialProps: { serverRows: [] } },
    )

    expect(result.current).toEqual([optimisticRow])

    rerender({ serverRows: [{ ...optimisticRow }] })

    await waitFor(() => {
      expect(result.current).toHaveLength(0)
    })
  })

  it('keeps the optimistic entry while server rows do not include its id', async () => {
    const { result, rerender } = renderHook(
      ({ serverRows }: { serverRows: MatchRow[] }) => useOptimisticCleanupHarness(serverRows),
      { initialProps: { serverRows: [] } },
    )

    rerender({ serverRows: [{ id: 'server-match-2', court_idx: 1, status: 'live' }] })

    await waitFor(() => {
      expect(result.current).toEqual([optimisticRow])
    })
  })
})
