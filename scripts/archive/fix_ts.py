import os

filepath = r'c:\Users\quock\OneDrive\picklematch-vn\components\home\PostMatchInboxSection.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()
content = content.replace('warningIcon', 'warningStrong')
content = content.replace('dangerIcon', 'dangerStrong')
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

filepath_session = r'c:\Users\quock\OneDrive\picklematch-vn\components\session\SessionCard.tsx'
with open(filepath_session, 'r', encoding='utf-8') as f:
    content = f.read()

if 'PROFILE_THEME_COLORS' not in content[:content.find('function')]:
    # Add import
    import_stmt = "\nimport { PROFILE_THEME_COLORS } from '@/components/profile/profileTheme'"
    content = content.replace('import { View', import_stmt + "\nimport { View")
    with open(filepath_session, 'w', encoding='utf-8') as f:
        f.write(content)

print('Fixed TS errors')
