import { MySession, SessionTab } from '@/components/sessions/MySessionCard'

export type HistorySection = {
  monthKey: string
  monthLabel: string
  items: MySession[]
}

export type HistoryRow =
  | { type: 'filters'; key: string }
  | { type: 'month'; key: string; monthKey: string; monthLabel: string; count: number }
  | { type: 'session'; key: string; session: MySession }

export { MySession, SessionTab }
