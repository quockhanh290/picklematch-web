import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import 'react-native-url-polyfill/auto'
import { Platform } from 'react-native'

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

import { safeStorageGetItem, safeStorageSetItem, safeStorageRemoveItem } from './storage'

const resilientStorage: StorageAdapter = {
  async getItem(key) {
    return safeStorageGetItem(key)
  },
  async setItem(key, value) {
    return safeStorageSetItem(key, value)
  },
  async removeItem(key) {
    return safeStorageRemoveItem(key)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: resilientStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
})
