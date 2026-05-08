import os

session_card = r'c:\Users\quock\OneDrive\picklematch-vn\components\session\SessionCard.tsx'
with open(session_card, 'r', encoding='utf-8') as f:
    content = f.read()

import_stmt = "\nimport { PROFILE_THEME_COLORS } from '@/components/profile/profileTheme'"
if 'PROFILE_THEME_COLORS' not in content[:content.find('function')]:
    content = content.replace("import { Pressable, Text, View } from 'react-native'", "import { Pressable, Text, View } from 'react-native'" + import_stmt)
    with open(session_card, 'w', encoding='utf-8') as f:
        f.write(content)
