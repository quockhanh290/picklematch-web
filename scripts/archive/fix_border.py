import os
import re

app_dir = r'c:\Users\quock\OneDrive\picklematch-vn'

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    orig_content = content
    
    # Fix BORDER.base.5 -> BORDER.medium
    content = content.replace('BORDER.base.5', 'BORDER.medium')

    if orig_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

modified = 0
for d in ['app', 'components', 'lib', 'hooks']:
    for root, _, files in os.walk(os.path.join(app_dir, d)):
        for file in files:
            if file.endswith(('.tsx', '.ts')):
                if process_file(os.path.join(root, file)):
                    modified += 1

print(f'Fixed {modified} files with BORDER.base.5 error')
