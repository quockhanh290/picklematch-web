import type { LucideIcon } from 'lucide-react-native'
import { Activity, Diamond, Sparkles, Swords, Trophy } from 'lucide-react-native'

export type CreateSessionSkillOption = {
  id: number
  label: string
  icon: LucideIcon
  activeClassName: string
  textClassName: string
  elo: number
  dupr: string
}

export const CREATE_SESSION_SKILL_OPTIONS: CreateSessionSkillOption[] = [
  {
    id: 1,
    label: '2.1',
    icon: Sparkles,
    activeClassName: 'bg-slate-100 border-slate-300',
    textClassName: 'text-slate-800',
    elo: 900,
    dupr: '2.5',
  },
  {
    id: 2,
    label: '2.6',
    icon: Activity,
    activeClassName: 'bg-emerald-50 border-emerald-300',
    textClassName: 'text-emerald-700',
    elo: 1075,
    dupr: '3.0',
  },
  {
    id: 3,
    label: '3.1',
    icon: Swords,
    activeClassName: 'bg-violet-50 border-violet-300',
    textClassName: 'text-violet-700',
    elo: 1225,
    dupr: '3.5',
  },
  {
    id: 4,
    label: '3.6',
    icon: Trophy,
    activeClassName: 'bg-orange-50 border-orange-300',
    textClassName: 'text-orange-700',
    elo: 1375,
    dupr: '4.0',
  },
  {
    id: 5,
    label: '4.6',
    icon: Diamond,
    activeClassName: 'bg-sky-50 border-sky-300',
    textClassName: 'text-sky-700',
    elo: 1525,
    dupr: '5.0',
  },
  {
    id: 6,
    label: '5.5+',
    icon: Trophy,
    activeClassName: 'bg-red-50 border-red-300',
    textClassName: 'text-red-700',
    elo: 1700,
    dupr: '5.5+',
  },
]

export const CREATE_SESSION_SKILL_INACTIVE_CLASSNAME =
  'bg-slate-50 border-slate-200 text-slate-500 opacity-80'

export function getCreateSessionSkillOption(level: number): CreateSessionSkillOption {
  return CREATE_SESSION_SKILL_OPTIONS.find((option) => option.id === level) ?? CREATE_SESSION_SKILL_OPTIONS[2]
}


