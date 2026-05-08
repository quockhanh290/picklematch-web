import AsyncStorage from '@react-native-async-storage/async-storage'

const memoryStorage = new Map<string, string>()

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
  } catch {
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
