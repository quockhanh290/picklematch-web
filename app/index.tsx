import { Redirect } from 'expo-router'
import { Platform } from 'react-native'

export default function IndexRoute() {
  if (Platform.OS === 'web') {
    return <Redirect href="/login" />
  }

  return <Redirect href="/(tabs)" />
}

