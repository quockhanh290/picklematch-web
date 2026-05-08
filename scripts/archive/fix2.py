import os
import re

# Fix _layout.tsx
layout_path = r'c:\Users\quock\OneDrive\picklematch-vn\app\(tabs)\_layout.tsx'
with open(layout_path, 'r', encoding='utf-8') as f:
    content = f.read()

match = re.search(r'import\s+\{([^}]+)\}\s+from\s+[\'"]@/constants/screenLayout[\'"]', content)
if match:
    imports = match.group(1)
    if 'SHADOW' not in imports:
        new_imports = imports.strip() + ', SHADOW'
        content = content.replace(match.group(0), f"import {{ {new_imports} }} from '@/constants/screenLayout'")
        with open(layout_path, 'w', encoding='utf-8') as f:
            f.write(content)

# Fix SessionCard.tsx
session_card = r'c:\Users\quock\OneDrive\picklematch-vn\components\session\SessionCard.tsx'
with open(session_card, 'r', encoding='utf-8') as f:
    content = f.read()

import_stmt = "\nimport { PROFILE_THEME_COLORS } from '@/components/profile/profileTheme'"
if 'PROFILE_THEME_COLORS' not in content[:content.find('function')]:
    content = content.replace('import { View', import_stmt + "\nimport { View")
    with open(session_card, 'w', encoding='utf-8') as f:
        f.write(content)

print('Fixed')
