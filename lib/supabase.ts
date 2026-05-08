import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import 'react-native-url-polyfill/auto'

type StorageAdapter = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY')
}

const memoryStorage = new Map<string, string>()

const resilientStorage: StorageAdapter = {
  async getItem(key) {
    try {
      const value = await AsyncStorage.getItem(key)
      return value ?? memoryStorage.get(key) ?? null
    } catch {
      return memoryStorage.get(key) ?? null
    }
  },
  async setItem(key, value) {
    memoryStorage.set(key, value)
    try {
      await AsyncStorage.setItem(key, value)
    } catch {
      // Fall back to in-memory storage when persistent storage is blocked.
    }
  },
  async removeItem(key) {
    memoryStorage.delete(key)
    try {
      await AsyncStorage.removeItem(key)
    } catch {
      // Ignore storage removal failures in constrained web/in-app environments.
    }
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: resilientStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
