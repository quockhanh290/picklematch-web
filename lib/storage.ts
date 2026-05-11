import AsyncStorage from '@react-native-async-storage/async-storage'

const memoryStorage = new Map<string, string>()

let storagePersistent: boolean | null = null

/**
 * Checks if AsyncStorage is actually persistent (not blocked by private mode/in-app browser).
 */
export async function checkStoragePersistence(): Promise<boolean> {
  if (storagePersistent !== null) return storagePersistent
  try {
    const testKey = '__pm_storage_test__'
    await AsyncStorage.setItem(testKey, '1')
    await AsyncStorage.removeItem(testKey)
    storagePersistent = true
  } catch {
    storagePersistent = false
  }
  return storagePersistent
}

export async function safeStorageGetItem(key: string): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(key)
    return value ?? memoryStorage.get(key) ?? null
  } catch {
    return memoryStorage.get(key) ?? null
  }
}

export async function safeStorageSetItem(key: string, value: string): Promise<void> {
  memoryStorage.set(key, value)
  try {
    await AsyncStorage.setItem(key, value)
    storagePersistent = true
  } catch {
    storagePersistent = false
    // Best-effort persistence; in-memory fallback remains available.
  }
}

export async function safeStorageRemoveItem(key: string): Promise<void> {
  memoryStorage.delete(key)
  try {
    await AsyncStorage.removeItem(key)
  } catch {
    // Best-effort cleanup.
  }
}
