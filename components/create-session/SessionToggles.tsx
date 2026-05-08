import React from 'react'
import { Switch, Text, View } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING, BORDER } from '@/constants/screenLayout'

interface SessionTogglesProps {
  isRanked: boolean
  setIsRanked: (value: boolean) => void
  canToggleRanked: boolean
  rankedHelperText: string | null
  requireApproval: boolean
  setRequireApproval: (value: boolean) => void
}
export function SessionToggles({
  isRanked,
  setIsRanked,
  canToggleRanked,
  rankedHelperText,
  requireApproval,
  setRequireApproval,
}: SessionTogglesProps) {
  const theme = useAppTheme()
  return (
    <View style={{ borderRadius: RADIUS.xl, borderWidth: BORDER.base, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceContainerLow, padding: SPACING.lg, marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.primary }}>{'Tính điểm xếp hạng'}</Text>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSecondaryContainer, marginTop: 2 }}>{'Kết quả sẽ ảnh hưởng đến ELO của bạn'}</Text>
        </View>
        <Switch
          value={isRanked}
          onValueChange={setIsRanked}
          disabled={!canToggleRanked}
          trackColor={{ false: theme.surfaceDim, true: theme.surfaceTint }}
          thumbColor={theme.surfaceContainerLowest}
        />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontFamily: SCREEN_FONTS.headline, fontSize: 16, color: theme.primary }}>{'Yêu cầu phê duyệt'}</Text>
          <Text style={{ fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onSecondaryContainer, marginTop: 2 }}>{'Chủ sân cần duyệt người tham gia'}</Text>
        </View>
        <Switch
          value={requireApproval}
          onValueChange={setRequireApproval}
          trackColor={{ false: theme.surfaceDim, true: theme.surfaceTint }}
          thumbColor={theme.surfaceContainerLowest}
        />
      </View>

      {!canToggleRanked && rankedHelperText ? (
        <Text style={{ marginTop: 10, fontFamily: SCREEN_FONTS.body, fontSize: 12, color: theme.onPrimaryFixedVariant }}>{rankedHelperText}</Text>
      ) : null}
    </View>
  )
}
