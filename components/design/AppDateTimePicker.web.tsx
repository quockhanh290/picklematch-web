import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useAppTheme } from '@/lib/theme-context'

export type AppDateTimePickerProps = {
  value: Date
  onChange: (date: Date) => void
  mode?: 'date' | 'time'
}

export const AppDateTimePicker = ({ value, onChange, mode = 'date' }: AppDateTimePickerProps) => {
  const theme = useAppTheme()

  const handleChange = (e: any) => {
    const val = e.target.value
    if (!val) return

    const newDate = new Date(value)
    if (mode === 'time') {
      const [hours, minutes] = val.split(':')
      newDate.setHours(parseInt(hours, 10))
      newDate.setMinutes(parseInt(minutes, 10))
    } else {
      const [year, month, day] = val.split('-')
      newDate.setFullYear(parseInt(year, 10))
      newDate.setMonth(parseInt(month, 10) - 1)
      newDate.setDate(parseInt(day, 10))
    }
    onChange(newDate)
  }

  const formattedValue = mode === 'time' 
    ? `${value.getHours().toString().padStart(2, '0')}:${value.getMinutes().toString().padStart(2, '0')}`
    : value.toISOString().split('T')[0]

  return (
    <View style={styles.container}>
      <input
        type={mode === 'time' ? 'time' : 'date'}
        value={formattedValue}
        onChange={handleChange}
        style={{
          padding: '12px',
          borderRadius: '8px',
          border: `1px solid ${theme.outlineVariant}`,
          backgroundColor: theme.surface,
          color: theme.onSurface,
          fontFamily: 'inherit',
          fontSize: '16px',
          width: '100%',
          outline: 'none',
          boxSizing: 'border-box'
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%'
  }
})
