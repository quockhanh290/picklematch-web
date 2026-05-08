import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { GestureDetector, Gesture } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated'
import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS } from '@/constants/screenLayout'

interface SkillRangeSelectorProps {
  minSkill: number // PVNA float (e.g. 2.5)
  maxSkill: number // PVNA float (e.g. 4.0)
  setMinSkill: (n: number) => void
  setMaxSkill: (n: number) => void
}

const THUMB_SIZE = 28
const TRACK_HEIGHT = 6
const HORIZONTAL_PADDING = THUMB_SIZE / 2

const MIN_PVNA = 2.0
const MAX_PVNA = 5.5
const RANGE = MAX_PVNA - MIN_PVNA

export function SkillRangeSelector({
  minSkill,
  maxSkill,
  setMinSkill,
  setMaxSkill,
}: SkillRangeSelectorProps) {
  const theme = useAppTheme()
  const [containerWidth, setContainerWidth] = React.useState(0)
  const sliderWidth = containerWidth - (HORIZONTAL_PADDING * 2)
  
  // Map PVNA value to position
  const getPosFromVal = (val: number) => {
    if (sliderWidth <= 0) return 0
    return ((val - MIN_PVNA) / RANGE) * sliderWidth
  }
  const getValFromPos = (pos: number) => {
    if (sliderWidth <= 0) return MIN_PVNA
    return (pos / sliderWidth) * RANGE + MIN_PVNA
  }

  const minPos = useSharedValue(0)
  const maxPos = useSharedValue(0)

  // Sync positions when width or skills change
  React.useEffect(() => {
    if (sliderWidth > 0) {
      minPos.value = getPosFromVal(minSkill)
      maxPos.value = getPosFromVal(maxSkill)
    }
  }, [sliderWidth, minSkill, maxSkill])

  const startMinPos = useSharedValue(0)
  const startMaxPos = useSharedValue(0)

  const updateMinSkill = (pos: number) => {
    const raw = getValFromPos(pos)
    const val = Math.round(raw * 10) / 10
    if (val !== minSkill) {
      setMinSkill(val)
    }
  }

  const updateMaxSkill = (pos: number) => {
    const raw = getValFromPos(pos)
    const val = Math.round(raw * 10) / 10
    if (val !== maxSkill) {
      setMaxSkill(val)
    }
  }

  const minGesture = Gesture.Pan()
    .onBegin(() => {
      startMinPos.value = minPos.value
    })
    .onUpdate((event) => {
      const nextPos = Math.max(0, Math.min(startMinPos.value + event.translationX, maxPos.value))
      minPos.value = nextPos
      runOnJS(updateMinSkill)(nextPos)
    })

  const maxGesture = Gesture.Pan()
    .onBegin(() => {
      startMaxPos.value = maxPos.value
    })
    .onUpdate((event) => {
      const nextPos = Math.max(minPos.value, Math.min(startMaxPos.value + event.translationX, sliderWidth))
      maxPos.value = nextPos
      runOnJS(updateMaxSkill)(nextPos)
    })

  const minThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: minPos.value }],
  }))

  const maxThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: maxPos.value }],
  }))

  const trackHighlightStyle = useAnimatedStyle(() => ({
    left: minPos.value + HORIZONTAL_PADDING,
    width: maxPos.value - minPos.value,
  }))

  const getGenderLevels = (val: number) => {
    const male = val.toFixed(1)
    const female = (Math.max(1.5, val - 0.5)).toFixed(1) // Changed 2.1 to 1.5 to allow more range
    return { male, female }
  }

  const minLevels = getGenderLevels(minSkill)
  const maxLevels = getGenderLevels(maxSkill)

  // Generate ticks for every 0.1
  const ticks = []
  for (let v = MIN_PVNA; v <= MAX_PVNA; v = Math.round((v + 0.1) * 10) / 10) {
    ticks.push(v)
  }

  return (
    <View style={styles.container} onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}>
      <View style={styles.header}>
        {/* Male Group */}
        <View style={[styles.skillChip, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}>
          <Text style={{ color: '#2563eb', fontFamily: SCREEN_FONTS.headline, fontSize: 16 }}>NAM</Text>
          <View style={styles.rangeValues}>
            <Text style={[styles.levelValue, { color: '#2563eb' }]}>{minLevels.male}</Text>
            <Text style={{ color: theme.outline, fontSize: 13, marginHorizontal: 2 }}>—</Text>
            <Text style={[styles.levelValue, { color: '#2563eb' }]}>{maxLevels.male}</Text>
          </View>
        </View>

        <View style={{ width: 1, height: 16, backgroundColor: theme.outlineVariant, marginHorizontal: 4 }} />

        {/* Female Group */}
        <View style={[styles.skillChip, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}>
          <Text style={{ color: '#db2777', fontFamily: SCREEN_FONTS.headline, fontSize: 16 }}>NỮ</Text>
          <View style={styles.rangeValues}>
            <Text style={[styles.levelValue, { color: '#db2777' }]}>{minLevels.female}</Text>
            <Text style={{ color: theme.outline, fontSize: 13, marginHorizontal: 2 }}>—</Text>
            <Text style={[styles.levelValue, { color: '#db2777' }]}>{maxLevels.female}</Text>
          </View>
        </View>
      </View>

      <View style={[styles.sliderWrapper, { paddingHorizontal: HORIZONTAL_PADDING }]}>
        <View style={[styles.track, { backgroundColor: theme.surfaceDim }]} />
        <Animated.View style={[styles.trackHighlight, { backgroundColor: theme.primary }, trackHighlightStyle]} />
        
        <GestureDetector gesture={minGesture}>
          <Animated.View style={[styles.thumb, { backgroundColor: theme.surface, borderColor: theme.primary }, minThumbStyle]}>
            <View style={[styles.thumbInner, { backgroundColor: theme.primary }]} />
          </Animated.View>
        </GestureDetector>

        <GestureDetector gesture={maxGesture}>
          <Animated.View style={[styles.thumb, { backgroundColor: theme.surface, borderColor: theme.primary }, maxThumbStyle]}>
            <View style={[styles.thumbInner, { backgroundColor: theme.primary }]} />
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={[styles.ticks, { paddingHorizontal: HORIZONTAL_PADDING }]}>
        {ticks.map((v) => {
          const isMajor = Math.round(v * 10) % 5 === 0 // 0.5 steps
          const isWhole = Math.round(v * 10) % 10 === 0 // 1.0 steps
          const isInRange = v >= minSkill && v <= maxSkill
          
          return (
            <View 
              key={v} 
              style={[
                styles.tick, 
                { 
                  height: isWhole ? 6 : (isMajor ? 4 : 2),
                  width: (isWhole || isMajor) ? 1.5 : 1,
                  backgroundColor: isInRange ? theme.primary : theme.outlineVariant,
                  opacity: (isWhole || isMajor) ? 1 : 0.4
                }
              ]} 
            />
          )
        })}
      </View>
      
      <Text style={[styles.hint, { color: theme.onSecondaryContainer }]}>
        Kéo hai đầu để chọn khoảng trình độ bạn mong muốn cho kèo này.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  skillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
  },
  rangeValues: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  levelValue: {
    fontSize: 16,
    fontFamily: SCREEN_FONTS.headline,
  },
  sliderWrapper: {
    height: THUMB_SIZE,
    justifyContent: 'center',
    marginHorizontal: 0,
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    width: '100%',
  },
  trackHighlight: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    position: 'absolute',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  thumbInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  ticks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 0,
    marginTop: 10,
    marginBottom: 16,
    height: 6,
  },
  tick: {
    borderRadius: 1,
  },
  hint: {
    fontFamily: SCREEN_FONTS.body,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
})
