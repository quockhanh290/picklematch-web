import { useSessionNav } from '@/lib/navigation/SessionNavContext'
import { Hand, LayoutList } from 'lucide-react-native'
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'

import { useAppTheme } from '@/lib/theme-context'
import type { PendingMatch } from '@/lib/homeFeed'

const pendingCardGap = 14

import { withAlpha } from '@/lib/utils/ui'
import { STRINGS } from '@/constants/strings'

function CarouselDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  const theme = useAppTheme()
  if (count <= 1) return null

  return (
    <View className="flex-row items-center gap-2">
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          className="h-2 rounded-full"
          style={{
            width: index === activeIndex ? 24 : 8,
            backgroundColor: index === activeIndex ? theme.primaryContainer : theme.outlineVariant,
          }}
        />
      ))}
    </View>
  )
}

function PendingMatchResultCard({ item, cardWidth }: { item: PendingMatch; cardWidth: number }) {
  const theme = useAppTheme()
  const { onViewMatchResult } = useSessionNav()
  return (
    <View
      className="mb-8 flex-row items-center gap-4 overflow-hidden rounded-[24px] border p-5"
      style={{
        borderColor: theme.secondaryFixedDim,
        backgroundColor: theme.primaryFixed,
        width: cardWidth,
        shadowColor: theme.primary,
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 3,
      }}
    >
      <View
        className="absolute -right-8 -top-10 h-28 w-28 rounded-full"
        style={{ backgroundColor: withAlpha(theme.primary, 0.1) }}
      />

      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{
          backgroundColor: theme.primary,
          shadowColor: theme.primary,
          shadowOpacity: 0.18,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
          elevation: 4,
        }}
      >
        <LayoutList size={22} color={theme.onPrimary} strokeWidth={2.5} />
      </View>

      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-black" style={{ color: theme.onPrimaryFixedVariant }}>
          {item.resultsStatus === 'disputed' ? STRINGS.home.pending_results.disputed_title : STRINGS.home.pending_results.required_title}
        </Text>
        <Text className="mt-2 truncate text-[11px] font-bold uppercase tracking-tight" style={{ color: withAlpha(theme.onPrimaryFixedVariant, 0.6) }}>
          {item.courtName}
        </Text>
        <Text className="mt-1 text-[13px] font-semibold" style={{ color: theme.onPrimaryFixedVariant }}>{item.timeLabel}</Text>
      </View>
 
      <Pressable
        onPress={() => onViewMatchResult(item.id)}
        className="rounded-full px-4 py-2.5"
        style={{ backgroundColor: theme.primaryContainer }}
      >
        <Text className="text-[11px] font-black uppercase" style={{ color: theme.onPrimary }}>
          {item.resultsStatus === 'disputed' ? STRINGS.home.pending_results.fix_now : STRINGS.home.pending_results.enter_now}
        </Text>
      </Pressable>
    </View>
  )
}

type Props = {
  items: PendingMatch[]
  activeIndex: number
  onIndexChange: (index: number) => void
}

export function PendingMatchResultCarousel({ items, activeIndex, onIndexChange }: Props) {
  const theme = useAppTheme()
  const { width: screenWidth } = useWindowDimensions()
  const pendingCardWidth = screenWidth - 88
  if (items.length === 0) return null

  if (items.length === 1) {
    return (
      <View className="mt-6">
        <PendingMatchResultCard item={items[0]} cardWidth={pendingCardWidth} />
      </View>
    )
  }

  return (
    <View className="mt-6">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={pendingCardWidth + pendingCardGap}
        snapToAlignment="start"
        disableIntervalMomentum
        contentContainerStyle={{ paddingRight: 28 }}
        onScroll={(event) => {
          const offsetX = event.nativeEvent.contentOffset.x
          const nextIndex = Math.round(offsetX / (pendingCardWidth + pendingCardGap))
          onIndexChange(nextIndex)
        }}
        scrollEventThrottle={16}
      >
        {items.map((item, index) => (
          <View key={item.id} style={{ marginRight: index === items.length - 1 ? 0 : pendingCardGap }}>
            <PendingMatchResultCard item={item} cardWidth={pendingCardWidth} />
          </View>
        ))}
      </ScrollView>

      <View className="-mt-3 flex-row items-center justify-between px-1">
        <CarouselDots count={items.length} activeIndex={activeIndex} />
        <View className="flex-row items-center rounded-full px-3 py-1.5" style={{ backgroundColor: theme.primaryFixed }}>
          <Hand size={14} color={theme.onPrimaryFixedVariant} strokeWidth={2.5} />
          <Text className="ml-1.5 text-[10px] font-black uppercase tracking-[1.4px]" style={{ color: theme.onPrimaryFixedVariant }}>
            {STRINGS.home.pending_results.swipe_hint}
          </Text>
        </View>
      </View>
    </View>
  )
}
