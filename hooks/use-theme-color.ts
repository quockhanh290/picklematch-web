import { defaultAppTheme, type AppTheme } from '@/constants/theme';

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof Pick<AppTheme, 'background' | 'text'>
) {
  const colorFromProps = props.light ?? props.dark;

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return defaultAppTheme[colorName];
  }
}
