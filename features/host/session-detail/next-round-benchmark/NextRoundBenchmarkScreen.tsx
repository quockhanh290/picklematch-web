import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'

import { calculateOptimalCourts } from '@/lib/court-calculator'
import { applyFairnessAdjustment, correctForFairness } from '@/lib/next-round-suggester/fairness/corrector'
import { computeSessionFairness } from '@/lib/next-round-suggester/fairness/metrics'
import { loadSessionState } from '@/lib/next-round-suggester/state'
import { suggestNextRound } from '@/lib/next-round-suggester/suggest'
import type { SessionState, SuggestionResult } from '@/lib/next-round-suggester/types'
import { supabase } from '@/lib/supabase'
import { useAppTheme } from '@/lib/theme-context'

import { suggestNextRoundExperimental, type ExperimentalSuggestionResult } from './experimental-suggest'

type Props = {
  sessionId: string
}

type RunResult = {
  state: SessionState
  courts: number
  present: number
  eligible: number
  baseline: {
    ms: number
    result: SuggestionResult
  }
  experimental: {
    ms: number
    result: ExperimentalSuggestionResult
  }
  loadMs: number
  fairnessMs: number
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function formatMs(value: number) {
  return `${Math.round(value)}ms`
}

function getPresentCount(state: SessionState) {
  return [...state.players.values()].filter((player) => player.checked_out_at === null).length
}

function getEligibleCount(state: SessionState) {
  return [...state.players.values()].filter((player) => player.checked_out_at === null && !player.opted_rest).length
}

export function NextRoundBenchmarkScreen({ sessionId }: Props) {
  const theme = useAppTheme()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)

  const styles = useMemo(() => ({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { padding: 16, paddingBottom: 40, gap: 12 },
    title: { fontSize: 24, fontWeight: '800' as const, color: theme.onSurface },
    body: { fontSize: 13, lineHeight: 19, color: theme.outline },
    card: {
      borderWidth: 1,
      borderColor: theme.outlineVariant,
      borderRadius: 8,
      padding: 14,
      backgroundColor: theme.surface,
      gap: 8,
    },
    button: {
      minHeight: 48,
      borderRadius: 8,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: theme.primary,
      paddingHorizontal: 16,
    },
    buttonText: { color: theme.onPrimary, fontSize: 14, fontWeight: '800' as const },
    label: { color: theme.outline, fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' as const },
    value: { color: theme.onSurface, fontSize: 16, fontWeight: '800' as const },
    code: { fontFamily: 'monospace', color: theme.onSurface, fontSize: 12, lineHeight: 17 },
    error: { color: '#9f1239', fontSize: 13, lineHeight: 18 },
  }), [theme])

  const run = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      const firstLoadStarted = now()
      const initialState = await loadSessionState(supabase as any, sessionId, {
        courts: 1,
        pvnaTolerance: 0.5,
      })
      const present = getPresentCount(initialState)
      const courtCalculator = calculateOptimalCourts({
        n_players: present,
        session_duration_min: 120,
        match_duration_min: 15,
        preset: 'balanced',
      })
      const courts = courtCalculator.recommended.courts

      const state = courts === initialState.config.courts
        ? initialState
        : await loadSessionState(supabase as any, sessionId, {
            courts,
            pvnaTolerance: 0.5,
          })
      const loadMs = now() - firstLoadStarted

      const fairnessStarted = now()
      const fairnessAdjustment = correctForFairness(state)
      const adjustedState = applyFairnessAdjustment(state, fairnessAdjustment)
      const fairnessMs = now() - fairnessStarted

      const baselineStarted = now()
      const baseline = suggestNextRound(adjustedState, {
        tier_overrides: fairnessAdjustment.tier_overrides,
      })
      const baselineMs = now() - baselineStarted

      const experimentalStarted = now()
      const experimental = suggestNextRoundExperimental(adjustedState, {
        tier_overrides: fairnessAdjustment.tier_overrides,
      })
      const experimentalMs = now() - experimentalStarted

      setResult({
        state: adjustedState,
        courts,
        present,
        eligible: getEligibleCount(adjustedState),
        baseline: { ms: baselineMs, result: baseline },
        experimental: { ms: experimentalMs, result: experimental },
        loadMs,
        fairnessMs,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }, [sessionId])

  const fairness = result ? computeSessionFairness(result.state) : null
  const speedup = result && result.experimental.ms > 0
    ? result.baseline.ms / result.experimental.ms
    : null

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View>
        <Text style={styles.title}>Next round benchmark</Text>
        <Text style={styles.body}>
          Page rieng de so sanh engine hien tai voi candidate-pool experimental. Khong start/end vong, khong ghi DB.
        </Text>
      </View>

      <Pressable style={styles.button} onPress={run} disabled={running}>
        {running ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={styles.buttonText}>CHAY BENCHMARK</Text>}
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {result ? (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>Session</Text>
            <Text style={styles.value}>{result.present} present / {result.eligible} eligible / {result.courts} courts</Text>
            <Text style={styles.code}>rounds={result.state.rounds.length} fairness={fairness?.score.overall ?? 'n/a'} load={formatMs(result.loadMs)} fairnessAdjust={formatMs(result.fairnessMs)}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Baseline production</Text>
            <Text style={styles.value}>{formatMs(result.baseline.ms)}</Text>
            <Text style={styles.code}>
              alternatives={result.baseline.result.alternatives.length} matches={result.baseline.result.alternatives[0]?.matches.length ?? 0} resting={result.baseline.result.alternatives[0]?.resting.length ?? 0}
            </Text>
            <Text style={styles.code}>score={result.baseline.result.alternatives[0]?.score.toFixed(2) ?? 'n/a'}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Experimental candidate pool</Text>
            <Text style={styles.value}>{formatMs(result.experimental.ms)}{speedup ? ` (${speedup.toFixed(2)}x)` : ''}</Text>
            <Text style={styles.code}>
              alternatives={result.experimental.result.alternatives.length} matches={result.experimental.result.alternatives[0]?.matches.length ?? 0} resting={result.experimental.result.alternatives[0]?.resting.length ?? 0}
            </Text>
            <Text style={styles.code}>score={result.experimental.result.alternatives[0]?.score.toFixed(2) ?? 'n/a'}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Experimental diagnostics</Text>
            <Text style={styles.code}>{JSON.stringify(result.experimental.result.diagnostic, null, 2)}</Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  )
}
