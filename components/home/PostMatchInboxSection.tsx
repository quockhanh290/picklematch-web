import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { useMemo, useState } from 'react'
import { Pressable, Text, View, ScrollView, useWindowDimensions } from 'react-native'

import { useAppTheme } from '@/lib/theme-context'
import { RADIUS, SHADOW, SPACING, BORDER } from '@/constants/screenLayout'
import { SCREEN_FONTS } from '@/constants/typography'
import type { PendingMatch, PostMatchAction } from '@/lib/homeFeed'
import { formatTimeRange } from '@/utils/formatters'
import { STRINGS } from '@/constants/strings'

type InboxItem = {
  key: string
  id: string
  courtName: string
  timeLabel: string
  startTime?: string
  endTime?: string
  deadlineAt?: string
  kind: 'confirm' | 'submit' | 'report'
  resultsStatus?: string | null
}

const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const DAY_MS = 24 * 60 * 60 * 1000

function deadlineFromEndTime(endTime?: string) {
  const endMs = Date.parse(endTime ?? '')
  if (Number.isNaN(endMs)) return undefined
  return new Date(endMs + DAY_MS).toISOString()
}

function buildInboxItems(pendingMatches: PendingMatch[], postMatchActions: PostMatchAction[]): InboxItem[] {
  const itemsFromPending: InboxItem[] = pendingMatches.map((item) => ({
    key: `submit-${item.id}`,
    id: item.id,
    courtName: item.courtName,
    timeLabel: item.timeLabel,
    startTime: item.startTime,
    endTime: item.endTime,
    deadlineAt: deadlineFromEndTime(item.endTime),
    kind: 'submit',
    resultsStatus: item.resultsStatus,
  }))

  const itemsFromActions: InboxItem[] = postMatchActions.map((item) => ({
    key: `${item.actionType}-${item.id}`,
    id: item.id,
    courtName: item.courtName,
    timeLabel: item.timeLabel,
    startTime: item.startTime,
    endTime: item.endTime,
    deadlineAt: deadlineFromEndTime(item.endTime),
    kind: item.actionType === 'confirm' ? 'confirm' : 'report',
    resultsStatus: item.resultsStatus,
  }))

  const priority: Record<InboxItem['kind'], number> = {
    submit: 0,
    confirm: 1,
    report: 2,
  }

  return [...itemsFromActions, ...itemsFromPending].sort((left, right) => {
    const leftDeadline = Date.parse(left.deadlineAt ?? '')
    const rightDeadline = Date.parse(right.deadlineAt ?? '')

    if (!Number.isNaN(leftDeadline) && !Number.isNaN(rightDeadline) && leftDeadline !== rightDeadline) {
      return leftDeadline - rightDeadline
    }

    return priority[left.kind] - priority[right.kind]
  })
}



function formatMatchMeta(item: InboxItem) {
  const start = new Date(item.startTime ?? '')
  const end = new Date(item.endTime ?? '')

  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    const dateLabel = `${DAY_LABELS[start.getDay()]}, ${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')}`
    return `${dateLabel} · ${formatTimeRange(start, end).replace('–', ' – ')}`
  }

  return item.timeLabel.replace(/^Kết thúc\s+/i, '')
}

function getDeadlineInfo(theme: any, deadlineAt?: string) {
  const deadlineMs = Date.parse(deadlineAt ?? '')
  if (Number.isNaN(deadlineMs)) {
    return {
      dotColor: theme.warningStrong,
      textColor: theme.onWarningContainer,
      label: STRINGS.home.inbox.deadline.waiting,
    }
  }

  const diffMs = deadlineMs - Date.now()
  const absMinutes = Math.max(1, Math.ceil(Math.abs(diffMs) / (60 * 1000)))
  const hours = Math.floor(absMinutes / 60)
  const minutes = absMinutes % 60

  if (diffMs < 0) {
    const overdue = hours >= 1 ? `${hours} tiếng` : `${absMinutes} phút`
    return {
      dotColor: theme.error,
      textColor: theme.error,
      label: STRINGS.home.inbox.deadline.overdue.replace('{time}', overdue),
    }
  }

  const remaining = hours >= 1 ? `${hours} tiếng` : `${minutes || absMinutes} phút`
  return {
    dotColor: theme.warningStrong,
    textColor: theme.onWarningContainer,
    label: STRINGS.home.inbox.deadline.remaining.replace('{time}', remaining),
  }
}

function InboxCard({ item }: { item: InboxItem }) {
  const theme = useAppTheme()
  const { onConfirmResult, onViewMatchResult, onRateSession } = useSessionNav()
  
  const presentation = useMemo(() => {
    if (item.kind === 'confirm') {
      return {
        chip: STRINGS.home.inbox.status.need_confirmation,
        cta: STRINGS.home.inbox.actions.confirm,
        onPress: () => onConfirmResult(item.id),
      }
    }

    if (item.kind === 'submit') {
      const isDisputed = item?.resultsStatus === 'disputed'
      return {
        chip: isDisputed ? STRINGS.home.inbox.status.disputed : STRINGS.home.inbox.status.need_result,
        cta: isDisputed ? STRINGS.home.inbox.actions.edit : STRINGS.home.inbox.actions.submit,
        onPress: () => onViewMatchResult(item.id),
      }
    }

    return {
      chip: STRINGS.home.inbox.status.need_rating,
      cta: STRINGS.home.inbox.actions.rate,
      onPress: () => onRateSession(item.id),
    }
  }, [item, onConfirmResult, onViewMatchResult, onRateSession])

  const deadline = getDeadlineInfo(theme, item.deadlineAt)

  return (
    <View
      className="overflow-hidden"
      style={{
        backgroundColor: theme.surface,
        borderColor: theme.outlineVariant,
        borderWidth: BORDER.hairline,
        borderRadius: RADIUS.md,
        ...SHADOW.xs,
      }}
    >
      <View style={{ borderLeftColor: theme.warningStrong, borderLeftWidth: 3, paddingHorizontal: SPACING.md, paddingVertical: 12 }}>
        <View className="mb-1.5 flex-row items-center">
          <View className="rounded-[4px] px-2 py-0.5" style={{ backgroundColor: theme.warningContainer }}>
            <Text className="text-[10px]" style={{ color: theme.onWarningContainer, fontFamily: SCREEN_FONTS.label, lineHeight: 14 }}>
              {presentation.chip}
            </Text>
          </View>
        </View>

        <Text
          className="mb-0.5 text-[17px] uppercase"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, lineHeight: 21 }}
        >
          {item.courtName}
        </Text>
        <Text className="text-[11px]" numberOfLines={1} style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, lineHeight: 15 }}>
          {formatMatchMeta(item)}
        </Text>
      </View>

      <View
        className="flex-row items-center justify-between"
        style={{ borderTopColor: theme.surfaceVariant, borderTopWidth: BORDER.hairline, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm }}
      >
        <View className="min-w-0 flex-1 flex-row items-center pr-3" style={{ columnGap: 5 }}>
          <View className="h-[5px] w-[5px] rounded-full" style={{ backgroundColor: deadline.dotColor }} />
          <Text className="text-[11px]" numberOfLines={1} style={{ color: deadline.textColor, fontFamily: SCREEN_FONTS.label, lineHeight: 15 }}>
            {deadline.label}
          </Text>
        </View>

        <Pressable onPress={presentation.onPress} className="rounded-full px-4 py-[7px]" style={{ backgroundColor: theme.warningStrong }}>
          <Text className="text-[15px] uppercase" style={{ color: theme.surface, fontFamily: SCREEN_FONTS.headline, lineHeight: 18 }}>
            {presentation.cta}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function CarouselDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  const theme = useAppTheme()
  if (count === 0) return null

  return (
    <View className="flex-row items-center gap-2">
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          className={`h-2 rounded-full ${index === activeIndex ? 'w-6' : 'w-2'}`}
          style={{ 
            backgroundColor: index === activeIndex ? theme.primary : theme.outlineVariant,
          }}
        />
      ))}
    </View>
  )
}

export function PostMatchInboxSection({
  pendingMatches,
  postMatchActions,
  marginTopClassName = 'mt-3',
}: {
  pendingMatches: PendingMatch[]
  postMatchActions: PostMatchAction[]
  marginTopClassName?: string
}) {
  const theme = useAppTheme()
  const { width: screenWidth } = useWindowDimensions()
  const [activeIndex, setActiveIndex] = useState(0)
  const inboxItems = useMemo(() => buildInboxItems(pendingMatches, postMatchActions), [pendingMatches, postMatchActions])

  if (inboxItems.length === 0) return null

  const countLabel = STRINGS.home.inbox.tasks_count.replace('{count}', inboxItems.length.toString())
  
  const screenPadding = 20
  const carouselGap = 14
  const cardWidth = screenWidth - screenPadding * 2

  return (
    <View className={marginTopClassName}>
      <View className="mb-3 flex-row items-baseline justify-between">
        <Text className="text-[15px]" style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.cta, lineHeight: 20 }}>
          {STRINGS.home.inbox.title}
        </Text>
        <Text className="text-[11px]" style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, lineHeight: 15 }}>
          {countLabel}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 8 }}
        snapToInterval={cardWidth + carouselGap}
        decelerationRate="fast"
        onScroll={(event) => {
          const offsetX = event.nativeEvent.contentOffset.x
          const nextIndex = Math.round(offsetX / (cardWidth + carouselGap))
          if (nextIndex !== activeIndex) {
            setActiveIndex(nextIndex)
          }
        }}
        scrollEventThrottle={16}
      >
        <View className="flex-row" style={{ columnGap: carouselGap }}>
          {inboxItems.map((item) => (
            <View key={item.key} style={{ width: cardWidth }}>
              <InboxCard item={item} />
            </View>
          ))}
        </View>
      </ScrollView>

      <View className="mt-4 items-center">
        <CarouselDots count={inboxItems.length} activeIndex={activeIndex} />
      </View>
    </View>
  )
}

