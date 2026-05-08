import type { FeedbackTrait } from '@/components/profile/CommunityFeedbackSection'
import type { TrophyBadge } from '@/components/profile/TrophyRoom'
import type { LucideIcon } from 'lucide-react-native'
import {
  AlertTriangle,
  Award,
  ClipboardList,
  Flame,
  Frown,
  GraduationCap,
  MapPin,
  Scale,
  ShieldCheck,
  ShieldQuestion,
  Swords,
  Timer,
  Trophy,
  Users,
} from 'lucide-react-native'
import { STRINGS } from '@/constants/strings'

export const FEEDBACK_META: Record<
  string,
  {
    icon: LucideIcon
    label: string
    context: string
    tone: 'positive' | 'negative'
  }
> = {
  fair_play: { icon: Award, label: STRINGS.profile.feedback.labels.fair_play, context: STRINGS.profile.feedback.contexts.fair_play, tone: 'positive' },
  on_time: { icon: Flame, label: STRINGS.profile.feedback.labels.on_time, context: STRINGS.profile.feedback.contexts.on_time, tone: 'positive' },
  friendly: { icon: Users, label: STRINGS.profile.feedback.labels.friendly, context: STRINGS.profile.feedback.contexts.friendly, tone: 'positive' },
  skilled: { icon: Swords, label: STRINGS.profile.feedback.labels.skilled, context: STRINGS.profile.feedback.contexts.skilled, tone: 'positive' },
  good_description: { icon: ClipboardList, label: STRINGS.profile.feedback.labels.good_description, context: STRINGS.profile.feedback.contexts.good_description, tone: 'positive' },
  well_organized: { icon: ShieldCheck, label: STRINGS.profile.feedback.labels.well_organized, context: STRINGS.profile.feedback.contexts.well_organized, tone: 'positive' },
  fair_pairing: { icon: Scale, label: STRINGS.profile.feedback.labels.fair_pairing, context: STRINGS.profile.feedback.contexts.fair_pairing, tone: 'positive' },
  toxic: { icon: Frown, label: STRINGS.profile.feedback.labels.toxic, context: STRINGS.profile.feedback.contexts.toxic, tone: 'negative' },
  late: { icon: Timer, label: STRINGS.profile.feedback.labels.late, context: STRINGS.profile.feedback.contexts.late, tone: 'negative' },
  dishonest: { icon: AlertTriangle, label: STRINGS.profile.feedback.labels.dishonest, context: STRINGS.profile.feedback.contexts.dishonest, tone: 'negative' },
  court_mismatch: { icon: MapPin, label: STRINGS.profile.feedback.labels.court_mismatch, context: STRINGS.profile.feedback.contexts.court_mismatch, tone: 'negative' },
  poor_organization: { icon: ShieldQuestion, label: STRINGS.profile.feedback.labels.poor_organization, context: STRINGS.profile.feedback.contexts.poor_organization, tone: 'negative' },
}

export const BADGE_REQUIREMENTS: Record<string, string> = {
  active_member_20: STRINGS.profile.achievements.requirements.active_member_20,
  giant_slayer: STRINGS.profile.achievements.requirements.giant_slayer,
  golden_host: STRINGS.profile.achievements.requirements.golden_host,
  win_streak_3: STRINGS.profile.achievements.requirements.win_streak_3,
}

export function calculateReliabilityScore(
  sessionsJoined?: number | null,
  noShowCount?: number | null,
  explicitReliabilityScore?: number | null,
) {
  if (explicitReliabilityScore != null) return Math.round(explicitReliabilityScore)
  if (!sessionsJoined) return null
  return Math.round(((sessionsJoined - (noShowCount ?? 0)) / sessionsJoined) * 100)
}

export function getBadgeIcon(iconName?: string | null): LucideIcon {
  switch (iconName) {
    case 'flame':
      return Flame
    case 'swords':
      return Swords
    case 'shield':
      return ShieldCheck
    case 'graduation-cap':
      return GraduationCap
    case 'trophy':
      return Trophy
    default:
      return Award
  }
}

export function getBadgeTone(category: TrophyBadge['category']): TrophyBadge['tone'] {
  switch (category) {
    case 'progression':
      return 'emerald'
    case 'performance':
      return 'rose'
    case 'momentum':
      return 'violet'
    case 'conduct':
      return 'amber'
  }
}

export function formatBadgeDate(dateString: string) {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

export function buildCommunityTraits(ratingTags: Record<string, number>) {
  return Object.entries(ratingTags)
    .map(([key, count]) => {
      const meta = FEEDBACK_META[key]
      if (!meta) return null

      return {
        key,
        icon: meta.icon,
        label: meta.label,
        count: `${meta.tone === 'positive' ? '+' : '-'}${count} ${STRINGS.profile.feedback.record_suffix}`,
        context: meta.context,
        tone: meta.tone,
      }
    })
    .filter((item): item is FeedbackTrait => Boolean(item))
    .sort((a, b) => {
      const aCount = Number.parseInt(a.count.replace(/[^\d]/g, ''), 10)
      const bCount = Number.parseInt(b.count.replace(/[^\d]/g, ''), 10)
      return bCount - aCount
    })
    .slice(0, 4)
}
