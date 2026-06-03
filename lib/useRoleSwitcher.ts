import { safeStorageSetItem } from './storage'
import { supabase } from './supabase'
import { DeviceEventEmitter } from 'react-native'

export function useRoleSwitcher() {
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
    DeviceEventEmitter.emit('role_changed')
  }

  const switchToPlayer = async () => {
    await safeStorageSetItem('user_role', 'player')
    DeviceEventEmitter.emit('role_changed')
  }

  return { switchToHost, switchToPlayer }
}
