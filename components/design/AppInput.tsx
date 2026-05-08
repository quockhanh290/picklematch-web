import { Text, TextInput, type TextInputProps, View } from 'react-native'
import { AppFontSet } from '@/constants/typography'
import { useAppTheme } from '@/lib/theme-context'

type Props = TextInputProps & {
  label?: string
  hint?: string
  leftIcon?: React.ReactNode
}

export function AppInput({ label, hint, leftIcon, ...props }: Props) {
  const theme = useAppTheme()
  return (
    <View>
      {label ? <Text className="mb-2 text-sm font-bold" style={{ color: theme.text, fontFamily: AppFontSet.title }}>{label}</Text> : null}
      <View className="flex-row items-center border rounded-2xl h-14 px-4" style={{ borderColor: theme.border, backgroundColor: theme.surface }}>
        {leftIcon ? <View className="mr-3">{leftIcon}</View> : null}
        <TextInput
          placeholderTextColor={theme.textSoft}
          className="flex-1 text-[16px]"
          style={{ color: theme.text, fontFamily: AppFontSet.body }}
          {...props}
        />
      </View>
      {hint ? <Text className="mt-2 text-xs leading-5" style={{ color: theme.textMuted, fontFamily: AppFontSet.body }}>{hint}</Text> : null}
    </View>
  )
}
