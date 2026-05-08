import { SCREEN_FONTS } from '@/constants/typography'
import { Modal, Pressable, Text, View } from 'react-native'

import { AppButton } from '@/components/design/AppButton'
import { useAppTheme } from '@/lib/theme-context'
import { RADIUS } from '@/constants/screenLayout'

export type AppDialogAction = {
  label: string
  onPress?: () => void | Promise<void>
  tone?: 'primary' | 'secondary' | 'danger'
}

export type AppDialogConfig = {
  title: string
  message: string
  actions: AppDialogAction[]
}

type Props = {
  visible: boolean
  config: AppDialogConfig | null
  onClose: () => void
}

export function AppDialog({ visible, config, onClose }: Props) {
  const theme = useAppTheme()
  if (!config) return null

  const actions = config.actions.slice(0, 3)

  const handleActionPress = async (action: AppDialogAction) => {
    onClose()
    await action.onPress?.()
  }

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 28 }}>
        <Pressable style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} onPress={onClose} />

        <View
          style={{
            borderRadius: RADIUS.hero,
            backgroundColor: theme.surface,
            paddingHorizontal: 24,
            paddingTop: 28,
            paddingBottom: 24,
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
            elevation: 8,
          }}
        >
          <Text
            style={{
              fontSize: 24,
              lineHeight: 28,
              color: theme.text,
              fontFamily: SCREEN_FONTS.headline,
              textTransform: 'uppercase',
            }}
          >
            {config.title}
          </Text>

          <Text
            style={{
              marginTop: 16,
              fontSize: 15,
              lineHeight: 22,
              color: theme.textMuted,
              fontFamily: SCREEN_FONTS.body,
            }}
          >
            {config.message}
          </Text>

          <View style={{ marginTop: 28, gap: 12 }}>
            {actions.map((action, index) => (
              <View key={`${action.label}-${index}`}>
                <AppButton
                  label={action.label}
                  onPress={() => void handleActionPress(action)}
                  variant={action.tone === 'danger' ? 'danger' : action.tone === 'secondary' ? 'secondary' : 'primary'}
                />
              </View>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  )
}
