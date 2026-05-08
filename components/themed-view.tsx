import { View, type ViewProps } from 'react-native';

import { useAppTheme } from '@/lib/theme-context';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
};

export function ThemedView({ style, lightColor, darkColor, ...otherProps }: ThemedViewProps) {
  const theme = useAppTheme();
  const backgroundColor = lightColor ?? darkColor ?? theme.background;

  return <View style={[{ backgroundColor }, style]} {...otherProps} />;
}
