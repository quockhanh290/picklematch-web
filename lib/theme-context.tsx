import { useColorScheme } from 'react-native';
import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';

import { AppThemes, defaultAppTheme, type AppTheme, type AppThemeId } from '@/constants/theme';

const ThemeContext = createContext<AppTheme>(defaultAppTheme);

export function AppThemeProvider({
  children,
  value,
  themeId,
}: PropsWithChildren<{ value?: AppTheme; themeId?: AppThemeId }>) {
  const colorScheme = useColorScheme();
  
  const resolvedTheme = useMemo(() => {
    if (value) return value;
    
    // In the future, we could pick a dark theme if colorScheme === 'dark'
    // const effectiveThemeId = themeId || (colorScheme === 'dark' ? 'dark-theme-id' : DEFAULT_PROFILE_THEME_ID);
    
    return themeId ? AppThemes[themeId] : defaultAppTheme;
  }, [value, themeId, colorScheme]);

  return <ThemeContext.Provider value={resolvedTheme}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
