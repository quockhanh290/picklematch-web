import React from 'react'
import { View } from 'react-native'

import { SheetAction, SheetTitle } from '../components'

export function MoreSheet({
  onSyncRoster,
  onOpenRoster,
  onOpenReport,
  onOpenHistory,
  onOpenFairness,
  canOpenReport,
  busy,
}: {
  onSyncRoster: () => void
  onOpenRoster: () => void
  onOpenReport: () => void
  onOpenHistory: () => void
  onOpenFairness: () => void
  canOpenReport: boolean
  busy: string | null
}) {
  return (
    <View>
      <SheetTitle title="Thao tác nhanh" />
      <View style={{ gap: 10 }}>
        {canOpenReport ? <SheetAction label="Xem report buổi chơi" onPress={onOpenReport} /> : null}
        <SheetAction label="Cập nhật danh sách người chơi" onPress={onSyncRoster} loading={busy === 'sync'} />
        <SheetAction label="Người chơi" onPress={onOpenRoster} />
        <SheetAction label="Đánh giá Fairness" onPress={onOpenFairness} />
        <SheetAction label="Lịch sử vòng" onPress={onOpenHistory} />
      </View>
    </View>
  )
}
