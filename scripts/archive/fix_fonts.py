import os
import re

MAPPING = {
    "'PlusJakartaSans-ExtraBoldItalic'": "SCREEN_FONTS.boldItalic",
    "'PlusJakartaSans-ExtraBold'": "SCREEN_FONTS.bold",
    "'PlusJakartaSans-Bold'": "SCREEN_FONTS.cta",
    "'PlusJakartaSans-SemiBold'": "SCREEN_FONTS.label",
    "'PlusJakartaSans-Medium'": "SCREEN_FONTS.medium",
    "'PlusJakartaSans-Regular'": "SCREEN_FONTS.body",
    "'BarlowCondensed-Black'": "SCREEN_FONTS.headlineBlack",
    "'BarlowCondensed-BoldItalic'": "SCREEN_FONTS.headlineItalic",
    "'BarlowCondensed-Bold'": "SCREEN_FONTS.headline",
}

IMPORT_STATEMENT = "import { SCREEN_FONTS } from '@/constants/screenFonts'\n"

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content
    modified = False

    for old_font, new_font in MAPPING.items():
        if old_font in content:
            content = content.replace(old_font, new_font)
            modified = True

    if modified:
        if "import { SCREEN_FONTS }" not in content and "import {SCREEN_FONTS}" not in content:
            # Insert import after the last import statement or at the top
            imports = list(re.finditer(r'^import .*?$', content, re.MULTILINE))
            if imports:
                last_import = imports[-1]
                insert_pos = last_import.end() + 1
                content = content[:insert_pos] + IMPORT_STATEMENT + content[insert_pos:]
            else:
                content = IMPORT_STATEMENT + content
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated fonts in: {filepath}")

def main():
    dirs_to_scan = [
        r'c:\Users\quock\OneDrive\picklematch-vn\app',
        r'c:\Users\quock\OneDrive\picklematch-vn\components'
    ]
    for d in dirs_to_scan:
        for root, _, files in os.walk(d):
            for file in files:
                if file.endswith('.tsx') or file.endswith('.ts'):
                    process_file(os.path.join(root, file))

if __name__ == '__main__':
    main()
