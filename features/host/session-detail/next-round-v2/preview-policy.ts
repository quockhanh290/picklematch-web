export function buildPreviewPolicyFingerprint({
  courtCount,
  pvnaTolerance,
  plannedTotalRounds,
  courtPreset,
  avoidPairs,
  liveQualityPolicy = 'current',
}: {
  courtCount: number
  pvnaTolerance: number
  plannedTotalRounds: number | null | undefined
  courtPreset: string
  avoidPairs: Array<{ player_a: string; player_b: string; reason?: string }>
  liveQualityPolicy?: string
}) {
  const avoidKey = avoidPairs
    .map(pair => [
      [String(pair.player_a), String(pair.player_b)].sort().join(':'),
      pair.reason ?? '',
    ].join(':'))
    .sort()
    .join(',')
  return [
    'preview-policy-v1',
    Math.max(1, Math.floor(courtCount)),
    Number(pvnaTolerance),
    plannedTotalRounds ?? 'unbounded',
    courtPreset,
    liveQualityPolicy,
    avoidKey,
  ].join('||')
}
