# PickleMatch VN Design System

## Single Source of Truth
- Base tokens live in [components/profile/profileTheme.ts](/C:/Users/quock/OneDrive/picklematch-vn/components/profile/profileTheme.ts).
- App theme mapping lives in [constants/theme.ts](/C:/Users/quock/OneDrive/picklematch-vn/constants/theme.ts).
- Runtime access is via `useAppTheme()` from [lib/theme-context.tsx](/C:/Users/quock/OneDrive/picklematch-vn/lib/theme-context.tsx).

Do not create standalone color systems outside this chain:
`profileTheme -> constants/theme -> useAppTheme`.

## Rules
1. Shared components in `components/design/*` must consume `useAppTheme()`.
2. Screen-level UI should prefer shared components before adding local style variants.
3. No hardcoded hex for reusable UI primitives (button/input/dialog/header/badge/card).
4. If a new semantic color is needed, add it in `profileTheme.ts` first, then map into `constants/theme.ts`.
5. Keep Vietnamese copy UTF-8 clean, no mojibake.

## Theme Expansion
1. Add a new `ProfileThemeId` and color set in `profileTheme.ts`.
2. Add semantic mapping in `PROFILE_THEME_SEMANTICS`.
3. `constants/theme.ts` will expose the new app theme through `AppThemes`.
4. Switch theme at provider level with `AppThemeProvider`.

## Migration Checklist
- Replace hardcoded utility colors (`bg-*`, `text-*`, `border-*`) in shared components.
- Replace direct `rgba(...)` overlays in shared components with token-based alpha helpers.
- Remove obsolete backup files and dead color constants after migration.
