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

interface SkillToleranceSelectorProps {
  tolerance: number
  setTolerance: (n: number) => void
}

const THUMB_SIZE = 24
const TRACK_HEIGHT = 4
const HORIZONTAL_PADDING = THUMB_SIZE / 2
const MAX_TOLERANCE = 0.1

export function SkillToleranceSelector({
  tolerance,
  setTolerance,
}: SkillToleranceSelectorProps) {
  const theme = useAppTheme()
  const [containerWidth, setContainerWidth] = React.useState(0)
  const sliderWidth = containerWidth - (HORIZONTAL_PADDING * 2)
  
  const getPosFromVal = (val: number) => {
    if (sliderWidth <= 0) return 0
    return (val / MAX_TOLERANCE) * sliderWidth
  }
  const getValFromPos = (pos: number) => {
    if (sliderWidth <= 0) return 0
    return (pos / sliderWidth) * MAX_TOLERANCE
  }

  const pos = useSharedValue(0)
  const startPos = useSharedValue(0)

  // Sync position when width or tolerance changes
  React.useEffect(() => {
    if (sliderWidth > 0) {
      pos.value = getPosFromVal(tolerance)
    }
  }, [sliderWidth, tolerance])

  const updateTolerance = (p: number) => {
    const raw = getValFromPos(p)
    const val = Math.round(raw * 100) / 100
    if (val !== tolerance) {
      setTolerance(val)
    }
  }

  const gesture = Gesture.Pan()
    .onBegin(() => {
      startPos.value = pos.value
    })
    .onUpdate((event) => {
      const nextPos = Math.max(0, Math.min(startPos.value + event.translationX, sliderWidth))
      pos.value = nextPos
      runOnJS(updateTolerance)(nextPos)
    })

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pos.value }],
  }))

  const trackHighlightStyle = useAnimatedStyle(() => ({
    left: HORIZONTAL_PADDING,
    width: pos.value,
  }))

  return (
    <View style={styles.container} onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.primary }]}>DUNG SAI (+/-)</Text>
        <Text style={[styles.value, { color: theme.primary }]}>{tolerance.toFixed(2)}</Text>
      </View>

      <View style={[styles.sliderWrapper, { paddingHorizontal: HORIZONTAL_PADDING }]}>
        <View style={[styles.track, { backgroundColor: theme.surfaceDim }]} />
        <Animated.View style={[styles.trackHighlight, { backgroundColor: theme.primary }, trackHighlightStyle]} />
        
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.thumb, { backgroundColor: theme.surface, borderColor: theme.primary }, thumbStyle]}>
            <View style={[styles.thumbInner, { backgroundColor: theme.primary }]} />
          </Animated.View>
        </GestureDetector>
      </View>
      
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 10,
    fontFamily: SCREEN_FONTS.headline,
    letterSpacing: 1,
  },
  value: {
    fontSize: 16,
    fontFamily: SCREEN_FONTS.headline,
  },
  sliderWrapper: {
    height: THUMB_SIZE,
    justifyContent: 'center',
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
    backgroundColor: 'white',
  },
  thumbInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  hint: {
    fontFamily: SCREEN_FONTS.body,
    fontSize: 10,
    marginTop: 8,
    opacity: 0.7,
  },
})
