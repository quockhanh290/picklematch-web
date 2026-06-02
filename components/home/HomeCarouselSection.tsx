import type { ReactNode } from 'react'
import { useState } from 'react'
import { Dimensions, Text, View } from 'react-native'
import Animated, {
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
  type SharedValue,
} from 'react-native-reanimated'

import { SCREEN_FONTS } from '@/constants/typography'
import { useAppTheme } from '@/lib/theme-context'

const screenPadding = 20
const screenWidth = Dimensions.get('window').width
const carouselCardWidth = screenWidth - screenPadding * 2
const carouselGap = 14

function CarouselDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  const theme = useAppTheme()
  if (count <= 1) return null

  return (
    <View className="flex-row items-center gap-2">
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          className={`h-2 rounded-full ${index === activeIndex ? 'w-6' : 'w-2'}`}
          style={{ backgroundColor: index === activeIndex ? theme.primary : theme.outlineVariant }}
        />
      ))}
    </View>
  )
}

function CarouselCard({
  index,
  itemCount,
  scrollOffset,
  children,
}: {
  index: number
  itemCount: number
  scrollOffset: SharedValue<number>
  children: ReactNode
}) {
  const cardStyle = useAnimatedStyle(() => {
    const itemOffset = index * (carouselCardWidth + carouselGap)
    const distance = Math.abs(scrollOffset.value - itemOffset)
    const progress = Math.min(distance / (carouselCardWidth + carouselGap), 1)

    return {
      opacity: 1 - progress * 0.2,
      transform: [
        { translateY: progress * 8 },
        { scale: 1 - progress * 0.04 },
      ],
    }
  })

  return (
    <Animated.View
      style={[
        {
          width: carouselCardWidth,
          marginRight: index === itemCount - 1 ? 0 : carouselGap,
        },
        cardStyle,
      ]}
    >
      {children}
    </Animated.View>
  )
}

function SwipeStack<T>({
  items,
  containerHeight,
  renderCard,
  onIndexChange,
}: {
  items: T[]
  containerHeight: number
  renderCard: (item: T) => ReactNode
  onIndexChange?: (index: number) => void
}) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const scrollOffset = useScrollViewOffset(scrollRef)
  const [measuredHeight, setMeasuredHeight] = useState(0)

  return (
    <Animated.ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      decelerationRate="fast"
      snapToInterval={carouselCardWidth + carouselGap}
      snapToAlignment="start"
      disableIntervalMomentum
      contentContainerStyle={{ paddingRight: 0 }}
      style={{ height: measuredHeight || containerHeight }}
      onScroll={(event) => {
        const offsetX = event.nativeEvent.contentOffset.x
        const nextIndex = Math.round(offsetX / (carouselCardWidth + carouselGap))
        onIndexChange?.(nextIndex)
      }}
    >
      {items.map((item, index) => (
        <CarouselCard
          key={String((item as { id?: string }).id ?? index)}
          index={index}
          itemCount={items.length}
          scrollOffset={scrollOffset}
        >
          <View
            onLayout={(event) => {
              const nextHeight = Math.ceil(event.nativeEvent.layout.height)
              if (nextHeight !== measuredHeight) {
                setMeasuredHeight(nextHeight)
              }
            }}
          >
            {renderCard(item)}
          </View>
        </CarouselCard>
      ))}
    </Animated.ScrollView>
  )
}

function SectionHeader({
  eyebrow,
  title,
}: {
  eyebrow: string
  title: string
}) {
  const theme = useAppTheme()
  return (
    <View className="mb-5">
      <Text className="mb-3 text-[11px] uppercase tracking-[0.16em]" style={{ color: theme.outline, fontFamily: SCREEN_FONTS.cta }}>
        {eyebrow}
      </Text>
      <Text className="text-[24px]" style={{ color: theme.onBackground, fontFamily: SCREEN_FONTS.headline, lineHeight: 32 }}>
        {title}
      </Text>
    </View>
  )
}

type Props<T> = {
  visible: boolean
  marginTopClassName?: string
  eyebrow: string
  title: string
  items: T[]
  activeIndex: number
  containerHeight: number
  onIndexChange: (index: number) => void
  renderCard: (item: T) => ReactNode
}

export function HomeCarouselSection<T>({
  visible,
  marginTopClassName = 'mt-10',
  eyebrow,
  title,
  items,
  activeIndex,
  containerHeight,
  onIndexChange,
  renderCard,
}: Props<T>) {
  if (!visible) return null

  return (
    <View className={marginTopClassName}>
      <SectionHeader eyebrow={eyebrow} title={title} />
      <SwipeStack
        items={items}
        containerHeight={containerHeight}
        renderCard={renderCard}
        onIndexChange={onIndexChange}
      />
      <View className="mt-4 items-center">
        <CarouselDots count={items.length} activeIndex={activeIndex} />
      </View>
    </View>
  )
}

