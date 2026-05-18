import { useRouter } from 'expo-router'
import { safeStorageSetItem } from './storage'
import { supabase } from './supabase'
import { Platform } from 'react-native'

export function useRoleSwitcher() {
  const router = useRouter()

  const switchToHost = async (userId: string, isAlreadyHost: boolean, onConfirmRequired?: () => Promise<boolean>) => {
    if (!isAlreadyHost && onConfirmRequired) {
      const confirmed = await onConfirmRequired()
      if (!confirmed) return
      
      // Update database to set is_host = true
      const { error } = await supabase
        .from('players')
        .update({ is_host: true })
        .eq('id', userId)
      
      if (error) {
        console.error('[useRoleSwitcher] Failed to activate host role:', error.message)
        return
      }
    }

    await safeStorageSetItem('user_role', 'host')
    router.replace('/host/dashboard' as any)
  }

  const switchToPlayer = async () => {
    await safeStorageSetItem('user_role', 'player')
    if (Platform.OS === 'web') {
      router.replace('/player-hub/profile' as any)
    } else {
      router.replace('/player-hub/find-session' as any)
    }
  }

  return { switchToHost, switchToPlayer }
}
