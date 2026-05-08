import type { LucideIcon } from 'lucide-react-native'
import { Activity, Medal, Sparkles, Swords, Trophy } from 'lucide-react-native'
import { AppTheme, defaultAppTheme } from '@/constants/theme'

import type { SkillAssessmentLevel } from './skillAssessment'

type SkillTierUi = {
  shortLabel: string
  icon: LucideIcon
  tagClassName: string
  textClassName: string
  borderClassName: string
  iconColor: string
  heroFrom: string
  heroTo: string
  duprValue: string
}

export function getSkillLevelUi(levelId?: SkillAssessmentLevel['id'] | null, theme?: AppTheme): SkillTierUi {
  const activeTheme = theme || defaultAppTheme
  
  const levels: Record<SkillAssessmentLevel['id'], SkillTierUi> = {
    pvna_1: {
      shortLabel: '2.1',
      icon: Sparkles,
      tagClassName: 'bg-slate-50',
      textClassName: 'text-slate-700',
      borderClassName: 'border-slate-200',
      iconColor: activeTheme.onSurfaceVariant,
      heroFrom: activeTheme.outline,
      heroTo: activeTheme.onSurfaceVariant,
      duprValue: '2.5',
    },
    pvna_2: {
      shortLabel: '2.6',
      icon: Activity,
      tagClassName: 'bg-emerald-50',
      textClassName: 'text-emerald-700',
      borderClassName: 'border-emerald-200',
      iconColor: activeTheme.primary,
      heroFrom: activeTheme.surfaceTint || activeTheme.primary,
      heroTo: activeTheme.primaryContainer,
      duprValue: '3.0',
    },
    pvna_3: {
      shortLabel: '3.1',
      icon: Swords,
      tagClassName: 'bg-indigo-50',
      textClassName: 'text-indigo-700',
      borderClassName: 'border-indigo-200',
      iconColor: activeTheme.secondary,
      heroFrom: activeTheme.secondary,
      heroTo: activeTheme.secondaryContainer,
      duprValue: '3.5',
    },
    pvna_4: {
      shortLabel: '3.6',
      icon: Medal,
      tagClassName: 'bg-amber-50',
      textClassName: 'text-amber-700',
      borderClassName: 'border-amber-200',
      iconColor: activeTheme.primary,
      heroFrom: activeTheme.primary,
      heroTo: activeTheme.primaryContainer,
      duprValue: '4.0',
    },
    pvna_5: {
      shortLabel: '4.6',
      icon: Trophy,
      tagClassName: 'bg-sky-50',
      textClassName: 'text-sky-700',
      borderClassName: 'border-sky-200',
      iconColor: activeTheme.tertiary,
      heroFrom: activeTheme.tertiary,
      heroTo: activeTheme.tertiaryContainer,
      duprValue: '5.0',
    },
    pvna_6: {
      shortLabel: '5.5+',
      icon: Trophy,
      tagClassName: 'bg-red-50',
      textClassName: 'text-red-700',
      borderClassName: 'border-red-200',
      iconColor: activeTheme.error,
      heroFrom: activeTheme.error,
      heroTo: activeTheme.errorContainer,
      duprValue: '5.5+',
    },
  }

  const id = levelId || 'pvna_1'
  return levels[id] ?? levels.pvna_1
}

export function getSkillTargetElo(eloMin: number, eloMax: number) {
  return Math.round((eloMin + eloMax) / 2)
}

