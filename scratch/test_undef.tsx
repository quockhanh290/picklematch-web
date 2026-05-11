import { safeStorageGetItem } from '@/lib/storage'
export const test = () => {
  safeStorageSetItem('key', 'value')
}
