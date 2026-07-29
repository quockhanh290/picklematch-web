import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { buildDegradedPreviewFieldsByCourtIdx, reattachDegradedPreviewFields } from './preview-degraded-fields.ts'

Deno.test('buildDegradedPreviewFieldsByCourtIdx only keeps courts carrying a degraded field', () => {
  const prePersistBoard = [
    { court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'], degraded_reason: 'blowout' as const, rescue_court_idxs: [2], match_explanations: ['gap 2.1'] },
    { court_idx: 1, team_a: ['e', 'f'], team_b: ['g', 'h'] },
    { court_idx: 2, team_a: ['i', 'j'], team_b: ['k', 'l'], match_explanations: ['repeat opponent'] },
  ]
  const map = buildDegradedPreviewFieldsByCourtIdx(prePersistBoard)
  assertEquals(map.size, 2)
  assertEquals(map.get(0), {
    degraded_reason: 'blowout',
    rescue_court_idxs: [2],
    match_explanations: ['gap 2.1'],
  })
  assertEquals(map.get(1), undefined)
  assertEquals(map.get(2), { match_explanations: ['repeat opponent'] })
})

Deno.test('reattachDegradedPreviewFields re-merges fields onto the stripped post-persist board by court_idx', () => {
  const prePersistBoard = [
    { court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'], degraded_reason: 'blowout' as const, rescue_court_idxs: [2], match_explanations: ['gap 2.1'] },
    { court_idx: 1, team_a: ['e', 'f'], team_b: ['g', 'h'] },
  ]
  const degradedFieldsByCourtIdx = buildDegradedPreviewFieldsByCourtIdx(prePersistBoard)

  // Simulates the RPC round-trip: only the 8 persisted columns survive, degraded fields are gone.
  const postPersistBoard = [
    { court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'], status: 'suggested' },
    { court_idx: 1, team_a: ['e', 'f'], team_b: ['g', 'h'], status: 'suggested' },
  ]

  const merged = reattachDegradedPreviewFields(postPersistBoard, degradedFieldsByCourtIdx)

  assertEquals((merged[0] as any).degraded_reason, 'blowout')
  assertEquals((merged[0] as any).rescue_court_idxs, [2])
  assertEquals((merged[0] as any).match_explanations, ['gap 2.1'])
  assertEquals((merged[1] as any).degraded_reason, undefined)
  assertEquals((merged[1] as any).rescue_court_idxs, undefined)
  assertEquals((merged[1] as any).match_explanations, undefined)
})

Deno.test('reattachDegradedPreviewFields never writes undefined onto a clean row when the map is empty', () => {
  const postPersistBoard = [
    { court_idx: 0, team_a: ['a', 'b'], team_b: ['c', 'd'], status: 'suggested' },
  ]
  const merged = reattachDegradedPreviewFields(postPersistBoard, new Map())
  assertEquals(merged, postPersistBoard)
  assertEquals('degraded_reason' in merged[0], false)
})
