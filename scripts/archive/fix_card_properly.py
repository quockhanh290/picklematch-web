import os

filepath = r'c:\Users\quock\OneDrive\picklematch-vn\components\home\MatchSessionCard.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

if 'import { RADIUS' not in content:
    content = content.replace('import { SCREEN_FONTS }', 'import { RADIUS, SHADOW, SPACING, BORDER } from \'@/constants/screenLayout\'\nimport { SCREEN_FONTS }')

old_standard_parent = '''className="overflow-hidden rounded-[32px] p-5"
      style={{
        minHeight: 300,
        backgroundColor: PROFILE_THEME_COLORS.surfaceContainerLowest,
        shadowColor: PROFILE_THEME_COLORS.onBackground,
        shadowOpacity: 0.06,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
      }}'''
new_standard_parent = '''className="overflow-hidden"
      style={{
        padding: SPACING.xl,
        minHeight: 300,
        borderRadius: RADIUS.hero,
        backgroundColor: PROFILE_THEME_COLORS.surfaceContainerLowest,
        ...SHADOW.sm,
      }}'''
content = content.replace(old_standard_parent, new_standard_parent)

old_standard_child = '''className="relative -mx-5 -mt-5 overflow-hidden px-5 pt-5 pb-4"
      >'''
new_standard_child = '''className="relative overflow-hidden"
        style={{ marginHorizontal: -SPACING.xl, marginTop: -SPACING.xl, paddingHorizontal: SPACING.xl, paddingTop: SPACING.xl, paddingBottom: SPACING.lg, borderTopLeftRadius: RADIUS.hero, borderTopRightRadius: RADIUS.hero }}
      >'''
content = content.replace(old_standard_child, new_standard_child)

old_compact_parent = '''className="overflow-hidden rounded-[24px] p-4"
      style={{
        backgroundColor: PROFILE_THEME_COLORS.surfaceContainerLowest,
        shadowColor: PROFILE_THEME_COLORS.onBackground,
        shadowOpacity: 0.04,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      }}'''
new_compact_parent = '''className="overflow-hidden"
      style={{
        padding: SPACING.lg,
        borderRadius: RADIUS.xl,
        backgroundColor: PROFILE_THEME_COLORS.surfaceContainerLowest,
        ...SHADOW.sm,
      }}'''
content = content.replace(old_compact_parent, new_compact_parent)

old_compact_child = '''className="relative -mx-4 -mt-4 overflow-hidden px-4 pt-4 pb-3"
      >'''
new_compact_child = '''className="relative overflow-hidden"
        style={{ marginHorizontal: -SPACING.lg, marginTop: -SPACING.lg, paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl }}
      >'''
content = content.replace(old_compact_child, new_compact_child)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print('Fixed MatchSessionCard.tsx Layout')
