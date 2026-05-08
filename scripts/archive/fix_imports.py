import os
import re

app_dir = r'c:\Users\quock\OneDrive\picklematch-vn'

def fix_imports(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    orig = content
    
    # If the file uses BORDER but doesn't import BORDER from screenLayout
    if 'BORDER.' in content:
        # Find the screenLayout import line
        match = re.search(r'import\s+\{([^}]+)\}\s+from\s+[\'"]@/constants/screenLayout[\'"]', content)
        if match:
            imports = match.group(1)
            if 'BORDER' not in imports:
                new_imports = imports.strip() + ', BORDER'
                content = content.replace(match.group(0), f"import {{ {new_imports} }} from '@/constants/screenLayout'")
    
    if 'BUTTON.' in content:
        match = re.search(r'import\s+\{([^}]+)\}\s+from\s+[\'"]@/constants/screenLayout[\'"]', content)
        if match:
            imports = match.group(1)
            if 'BUTTON' not in imports:
                new_imports = imports.strip() + ', BUTTON'
                content = content.replace(match.group(0), f"import {{ {new_imports} }} from '@/constants/screenLayout'")

    if 'RADIUS.' in content:
        match = re.search(r'import\s+\{([^}]+)\}\s+from\s+[\'"]@/constants/screenLayout[\'"]', content)
        if match:
            imports = match.group(1)
            if 'RADIUS' not in imports:
                new_imports = imports.strip() + ', RADIUS'
                content = content.replace(match.group(0), f"import {{ {new_imports} }} from '@/constants/screenLayout'")

    if orig != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

modified = 0
for d in ['app', 'components', 'lib', 'hooks']:
    for root, _, files in os.walk(os.path.join(app_dir, d)):
        for file in files:
            if file.endswith(('.tsx', '.ts')):
                if fix_imports(os.path.join(root, file)):
                    modified += 1

print(f'Fixed imports in {modified} files')
