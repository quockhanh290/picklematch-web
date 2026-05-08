import { useRouter } from 'expo-router'
import { safeStorageSetItem } from './storage'

export function useRoleSwitcher() {
  const router = useRouter()

  const switchToHost = async () => {
    await safeStorageSetItem('user_role', 'host')
    // Force redirect to host dashboard
    router.replace('/host/dashboard' as any)
  }

  const switchToPlayer = async () => {
    await safeStorageSetItem('user_role', 'player')
    // Force redirect to player feed (tabs)
    router.replace('/(tabs)' as any)
  }

  return { switchToHost, switchToPlayer }
}
