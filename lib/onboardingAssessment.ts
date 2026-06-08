import { getLegacySkillLabelForTier, getLevelIdForElo, getSimpleTierLabel, getTierForElo, type EloLevelId } from './eloSystem'
import { STRINGS } from '@/constants/strings'

export type OnboardingQuestionId =
  | 'time_playing'
  | 'sport_background'
  | 'rally'
  | 'kitchen'
  | 'overhead'
  | 'win_rate'
  | 'play_preference'

export type OnboardingOption = {
  id: string
  label: string
  score: number
}

export type OnboardingQuestion = {
  id: OnboardingQuestionId
  question: string
  subtitle?: string
  options: OnboardingOption[]
  noScore?: boolean
}

export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: 'time_playing',
    question: STRINGS.onboarding.assessment.time_playing.question,
    options: [
      { id: 'time_none', label: STRINGS.onboarding.assessment.time_playing.options.none, score: 0 },
      { id: 'time_beginner', label: STRINGS.onboarding.assessment.time_playing.options.beginner, score: 10 },
      { id: 'time_intermediate', label: STRINGS.onboarding.assessment.time_playing.options.intermediate, score: 25 },
      { id: 'time_advanced', label: STRINGS.onboarding.assessment.time_playing.options.advanced, score: 40 },
      { id: 'time_expert', label: STRINGS.onboarding.assessment.time_playing.options.expert, score: 55 },
    ],
  },
  {
    id: 'sport_background',
    question: STRINGS.onboarding.assessment.sport_background.question,
    subtitle: STRINGS.onboarding.assessment.sport_background.subtitle,
    options: [
      { id: 'sport_none', label: STRINGS.onboarding.assessment.sport_background.options.none, score: 0 },
      { id: 'sport_pingpong', label: STRINGS.onboarding.assessment.sport_background.options.pingpong, score: 15 },
      { id: 'sport_badminton', label: STRINGS.onboarding.assessment.sport_background.options.badminton, score: 20 },
      { id: 'sport_tennis', label: STRINGS.onboarding.assessment.sport_background.options.tennis, score: 10 },
      { id: 'sport_other', label: STRINGS.onboarding.assessment.sport_background.options.other, score: 5 },
    ],
  },
  {
    id: 'rally',
    question: STRINGS.onboarding.assessment.rally.question,
    subtitle: STRINGS.onboarding.assessment.rally.subtitle,
    options: [
      { id: 'rally_fail', label: STRINGS.onboarding.assessment.rally.options.fail, score: 0 },
      { id: 'rally_unstable', label: STRINGS.onboarding.assessment.rally.options.unstable, score: 15 },
      { id: 'rally_stable', label: STRINGS.onboarding.assessment.rally.options.stable, score: 30 },
      { id: 'rally_proactive', label: STRINGS.onboarding.assessment.rally.options.proactive, score: 45 },
    ],
  },
  {
    id: 'kitchen',
    question: STRINGS.onboarding.assessment.kitchen.question,
    subtitle: STRINGS.onboarding.assessment.kitchen.subtitle,
    options: [
      { id: 'kitchen_unknown', label: STRINGS.onboarding.assessment.kitchen.options.unknown, score: 0 },
      { id: 'kitchen_faulty', label: STRINGS.onboarding.assessment.kitchen.options.faulty, score: 10 },
      { id: 'kitchen_dink_stable', label: STRINGS.onboarding.assessment.kitchen.options.dink_stable, score: 25 },
      { id: 'kitchen_pressure', label: STRINGS.onboarding.assessment.kitchen.options.pressure, score: 40 },
    ],
  },
  {
    id: 'overhead',
    question: STRINGS.onboarding.assessment.overhead.question,
    subtitle: STRINGS.onboarding.assessment.overhead.subtitle,
    options: [
      { id: 'overhead_fail', label: STRINGS.onboarding.assessment.overhead.options.fail, score: 0 },
      { id: 'overhead_weak', label: STRINGS.onboarding.assessment.overhead.options.weak, score: 10 },
      { id: 'overhead_smash_unstable', label: STRINGS.onboarding.assessment.overhead.options.smash_unstable, score: 20 },
      { id: 'overhead_smash_proactive', label: STRINGS.onboarding.assessment.overhead.options.smash_proactive, score: 30 },
    ],
  },
  {
    id: 'win_rate',
    question: STRINGS.onboarding.assessment.win_rate.question,
    options: [
      { id: 'win_learn', label: STRINGS.onboarding.assessment.win_rate.options.learn, score: 0 },
      { id: 'win_less', label: STRINGS.onboarding.assessment.win_rate.options.less, score: 15 },
      { id: 'win_equal', label: STRINGS.onboarding.assessment.win_rate.options.equal, score: 25 },
      { id: 'win_more', label: STRINGS.onboarding.assessment.win_rate.options.more, score: 35 },
      { id: 'win_pro', label: STRINGS.onboarding.assessment.win_rate.options.pro, score: 50 },
    ],
  },
  {
    id: 'play_preference',
    question: STRINGS.onboarding.assessment.play_preference.question,
    subtitle: STRINGS.onboarding.assessment.play_preference.subtitle,
    options: [
      { id: 'pref_beginner', label: STRINGS.onboarding.assessment.play_preference.options.beginner, score: 0 },
      { id: 'pref_higher', label: STRINGS.onboarding.assessment.play_preference.options.higher, score: 0 },
      { id: 'pref_fun', label: STRINGS.onboarding.assessment.play_preference.options.fun, score: 0 },
      { id: 'pref_serious', label: STRINGS.onboarding.assessment.play_preference.options.serious, score: 0 },
    ],
    noScore: true,
  },
]

export type OnboardingAnswers = Partial<Record<OnboardingQuestionId, number>>
export type OnboardingLabels = Partial<Record<OnboardingQuestionId, string>>

export function calculateInitialElo(
  answers: OnboardingAnswers,
  timePlayingId: string,
  preference: string
): {
  elo: number
  tier: string
  preference: string
} {
  const totalScore = Object.entries(answers)
    .filter(([key]) => key !== 'play_preference')
    .reduce((sum, [, score]) => sum + (score ?? 0), 0)

  let elo: number
  if (totalScore <= 35) elo = 800
  else if (totalScore <= 70) elo = 900
  else if (totalScore <= 105) elo = 1000
  else if (totalScore <= 140) elo = 1100
  else if (totalScore <= 180) elo = 1200
  else if (totalScore <= 215) elo = 1300
  else elo = 1375

  const ceilings: Record<string, number> = {
    'time_none': 900,
    'time_beginner': 1050,
    'time_intermediate': 1200,
    'time_advanced': 1350,
    'time_expert': 1425,
  }

  const ceiling = ceilings[timePlayingId] ?? 1350
  elo = Math.min(elo, ceiling)

  return { elo, tier: getTierForElo(elo), preference }
}

export function getSelfAssessedLevelForElo(elo: number): EloLevelId {
  return getLevelIdForElo(elo)
}

export { getLegacySkillLabelForTier, getSimpleTierLabel }
