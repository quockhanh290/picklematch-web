import { MySession, SessionTab } from '@/components/sessions/MySessionCard'

export type HistorySection = {
  monthKey: string
  monthLabel: string
  items: MySession[]
}

export type SessionRow =
  | { type: 'section-header'; key: string; label: string; count?: number }
  | { type: 'next-session'; key: string; session: MySession }
  | { type: 'month'; key: string; monthKey: string; monthLabel: string; count: number }
  | { type: 'session'; key: string; session: MySession }

export { MySession, SessionTab }
