import React from 'react'
import DateTimePicker from '@react-native-community/datetimepicker'
import { Platform } from 'react-native'

export type AppDateTimePickerProps = {
  value: Date
  onChange: (date: Date) => void
  mode?: 'date' | 'time'
  display?: 'default' | 'spinner' | 'calendar' | 'clock'
}

export const AppDateTimePicker = ({ value, onChange, mode = 'date', display = 'default' }: AppDateTimePickerProps) => {
  if (Platform.OS === 'web') return null
  
  return (
    <DateTimePicker
      value={value}
      mode={mode}
      display={display}
      onChange={(_, date) => {
        if (date) onChange(date)
      }}
    />
  )
}
