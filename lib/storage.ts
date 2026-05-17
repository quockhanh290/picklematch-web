import AsyncStorage from '@react-native-async-storage/async-storage'

const memoryStorage = new Map<string, string>()

let storagePersistent: boolean | null = null

function getBrowserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window[kind] ?? null
  } catch {
    return null
  }
}

function browserStorageAvailable(storage: Storage | null): storage is Storage {
  if (!storage) return false
  try {
    const testKey = '__pm_storage_probe__'
    storage.setItem(testKey, '1')
    storage.removeItem(testKey)
    return true
  } catch {
    return false
  }
}

function getWritableBrowserStorages(): Storage[] {
  return [getBrowserStorage('localStorage'), getBrowserStorage('sessionStorage')]
    .filter(browserStorageAvailable)
}

/**
 * Checks if AsyncStorage is actually persistent (not blocked by private mode/in-app browser).
 */
export async function checkStoragePersistence(): Promise<boolean> {
  if (storagePersistent !== null) return storagePersistent
  if (getWritableBrowserStorages().length > 0) {
    storagePersistent = true
    return storagePersistent
  }
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
  for (const storage of getWritableBrowserStorages()) {
    try {
      const value = storage.getItem(key)
      if (value !== null) return value
    } catch {
      // Try the next storage fallback.
    }
  }

  try {
    const value = await AsyncStorage.getItem(key)
    return value ?? memoryStorage.get(key) ?? null
  } catch {
    return memoryStorage.get(key) ?? null
  }
}

export async function safeStorageSetItem(key: string, value: string): Promise<void> {
  memoryStorage.set(key, value)
  let persisted = false

  for (const storage of getWritableBrowserStorages()) {
    try {
      storage.setItem(key, value)
      persisted = true
    } catch {
      // Best-effort persistence; keep trying fallbacks.
    }
  }

  try {
    await AsyncStorage.setItem(key, value)
    persisted = true
  } catch {
    // Best-effort persistence; in-memory fallback remains available.
  }

  storagePersistent = persisted
}

export async function safeStorageRemoveItem(key: string): Promise<void> {
  memoryStorage.delete(key)
  for (const storage of getWritableBrowserStorages()) {
    try {
      storage.removeItem(key)
    } catch {
      // Best-effort cleanup.
    }
  }

  try {
    await AsyncStorage.removeItem(key)
  } catch {
    // Best-effort cleanup.
  }
}
