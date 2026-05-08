import { AppTheme } from '@/constants/theme'
import {
    AlertTriangle,
    Bell,
    CheckCircle2,
    DoorOpen,
    Info,
    Megaphone,
    MessageCircleMore,
    Sparkles,
    Trophy,
    UserPlus,
    XCircle,
} from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import type { Notification } from './types'

export function withAlpha(hex: string, alpha: number) {
  const clean = hex.replace('#', '')
  const n = Number.parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function typeMeta(type: string, theme: AppTheme): {
  icon: LucideIcon
  iconColor: string
  iconBackground: string
  indicator: string
} {
  if (type === 'join_request') {
    return {
      icon: UserPlus,
      iconColor: theme.onPrimary,
      iconBackground: theme.primary,
      indicator: theme.primary,
    }
  }
  if (type === 'join_approved') {
    return {
      icon: CheckCircle2,
      iconColor: theme.onPrimary,
      iconBackground: theme.primary,
      indicator: theme.primary,
    }
  }
  if (type === 'join_rejected') {
    return {
      icon: XCircle,
      iconColor: theme.onPrimary,
      iconBackground: theme.primary,
      indicator: theme.error,
    }
  }
  if (type === 'player_left') {
    return {
      icon: DoorOpen,
      iconColor: theme.onPrimary,
      iconBackground: theme.primary,
      indicator: theme.surfaceTint,
    }
  }
  if (type === 'session_cancelled') {
    return {
      icon: Megaphone,
      iconColor: theme.onPrimary,
      iconBackground: theme.primary,
      indicator: theme.error,
    }
  }
  if (type === 'session_updated') {
    return {
      icon: Sparkles,
      iconColor: theme.onPrimary,
      iconBackground: theme.primary,
      indicator: theme.surfaceTint,
    }
  }
  if (type === 'join_request_reply') {
    return {
      icon: MessageCircleMore,
      iconColor: theme.onPrimary,
      iconBackground: theme.primary,
      indicator: theme.primary,
    }
  }
  if (type === 'achievement_unlocked') {
    return {
      icon: Trophy,
      iconColor: theme.onPrimary,
      iconBackground: theme.primary,
      indicator: theme.tertiary,
    }
  }
  if (type === 'host_unprofessional_reported') {
    return {
      icon: AlertTriangle,
      iconColor: theme.onPrimary,
      iconBackground: theme.primary,
      indicator: theme.error,
    }
  }
  if (type === 'result_confirmation_request') {
    return {
      icon: CheckCircle2,
      iconColor: theme.onPrimary,
      iconBackground: theme.primary,
      indicator: theme.primary,
    }
  }

  if (
    type === 'session_pending_completion' || 
    type === 'session_results_submitted' || 
    type === 'session_results_disputed' || 
    type === 'session_auto_closed' || 
    type === 'ghost_session_voided'
  ) {
    return {
      icon: Bell,
      iconColor: theme.onPrimary,
      iconBackground: theme.primary,
      indicator: theme.primary,
    }
  }
  
  return {
    icon: Info,
    iconColor: theme.onPrimary,
    iconBackground: theme.primary,
    indicator: theme.outline,
  }
}

export function isActionable(notification: Notification) {
  return notification.type === 'join_request'
}
